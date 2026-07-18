//! HTTP server host bindings — V8 FFI bridge for framework/net/httpserver.zig.
//!
//! JS surface (mirrors runtime/hooks/useHost.ts kind:'http'):
//!   __httpsrv_listen(id, port, routesJson) → 1 on success, 0 on failure
//!   __httpsrv_respond(id, clientId, status, contentType, body)
//!   __httpsrv_close(id)
//!
//! Events fire via __ffiEmit each frame (tickDrain):
//!   __ffiEmit('httpsrv:request:<id>', '{"clientId":N,"method":"GET","path":"/foo","body":"..."}')
//!
//! Multiple servers can coexist; the JS-supplied `id` namespaces them.
//! Route specs are JSON: [{path:"/api", kind:"handler"}, {path:"/static", kind:"static", root:"/var/www"}].
//! "handler" routes emit a request event; the cart must call respond(). "static" routes are served
//! synchronously by the Zig side (no event emitted).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");
const httpserver = @import("net/httpserver.zig");

const alloc = std.heap.c_allocator;

// ── Server registry ────────────────────────────────────────────────

const Server = struct {
    id: u32,
    server: *httpserver.HttpServer,
    // Backing storage for route paths/roots — JS-owned strings get copied here
    // so the route table can outlive the JS string handles.
    route_paths: [16][512]u8 = undefined,
    route_roots: [16][512]u8 = undefined,
    route_path_lens: [16]usize = [_]usize{0} ** 16,
    route_root_lens: [16]usize = [_]usize{0} ** 16,
};

var g_servers: std.ArrayList(Server) = .empty;

fn findServer(id: u32) ?*Server {
    for (g_servers.items) |*s| {
        if (s.id == id) return s;
    }
    return null;
}

fn removeServer(id: u32) void {
    var i: usize = g_servers.items.len;
    while (i > 0) {
        i -= 1;
        if (g_servers.items[i].id == id) {
            g_servers.items[i].server.close();
            alloc.destroy(g_servers.items[i].server);
            _ = g_servers.orderedRemove(i);
            return;
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argToU32(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    const v = info.getArg(idx).toI32(ctx) catch return null;
    return if (v >= 0) @intCast(v) else null;
}

fn emitEvent(host: *HostContext, channel: []const u8, payload: []const u8) void {
    var chan_buf: std.ArrayList(u8) = .empty;
    defer chan_buf.deinit(alloc);
    chan_buf.appendSlice(alloc, channel) catch return;
    chan_buf.append(alloc, 0) catch return;
    const chan_z = chan_buf.items[0 .. chan_buf.items.len - 1 :0];

    var payload_buf: std.ArrayList(u8) = .empty;
    defer payload_buf.deinit(alloc);
    payload_buf.appendSlice(alloc, payload) catch return;
    payload_buf.append(alloc, 0) catch return;
    const payload_z = payload_buf.items[0 .. payload_buf.items.len - 1 :0];

    v8_runtime.callGlobal2Str(host, "__ffiEmit", chan_z, payload_z);
}

// JSON-escape a string into out_buf. Returns bytes written.
fn jsonEscape(in: []const u8, out: []u8) usize {
    var pos: usize = 0;
    for (in) |c| {
        if (pos + 6 >= out.len) break;
        switch (c) {
            '"' => {
                out[pos] = '\\';
                out[pos + 1] = '"';
                pos += 2;
            },
            '\\' => {
                out[pos] = '\\';
                out[pos + 1] = '\\';
                pos += 2;
            },
            '\n' => {
                out[pos] = '\\';
                out[pos + 1] = 'n';
                pos += 2;
            },
            '\r' => {
                out[pos] = '\\';
                out[pos + 1] = 'r';
                pos += 2;
            },
            '\t' => {
                out[pos] = '\\';
                out[pos + 1] = 't';
                pos += 2;
            },
            0x00...0x08, 0x0b, 0x0c, 0x0e...0x1f => {
                _ = std.fmt.bufPrint(out[pos..], "\\u{x:0>4}", .{c}) catch break;
                pos += 6;
            },
            else => {
                out[pos] = c;
                pos += 1;
            },
        }
    }
    return pos;
}

// ── JSON route parser (minimal) ────────────────────────────────────

fn parseRoutes(s: *Server, json: []const u8, out_routes: []httpserver.Route) usize {
    // Expected shape: [{"path":"...","kind":"handler"},{"path":"...","kind":"static","root":"..."}]
    // Hand-rolled because we're allergic to a full JSON dep here and the shape is small.
    var count: usize = 0;
    var i: usize = 0;
    while (i < json.len and count < out_routes.len) : (i += 1) {
        if (json[i] != '{') continue;
        const obj_end = std.mem.indexOfScalarPos(u8, json, i, '}') orelse break;
        const obj = json[i .. obj_end + 1];

        // path
        const path = extractField(obj, "path") orelse {
            i = obj_end;
            continue;
        };
        // kind (default handler)
        const kind = extractField(obj, "kind") orelse "handler";
        const root = extractField(obj, "root");

        // Copy path into backing storage
        const plen = @min(path.len, s.route_paths[count].len);
        @memcpy(s.route_paths[count][0..plen], path[0..plen]);
        s.route_path_lens[count] = plen;

        var route = httpserver.Route{
            .path = s.route_paths[count][0..plen],
            .route_type = if (std.mem.eql(u8, kind, "static")) .static else .handler,
            .root = null,
        };

        if (root) |r| {
            const rlen = @min(r.len, s.route_roots[count].len);
            @memcpy(s.route_roots[count][0..rlen], r[0..rlen]);
            s.route_root_lens[count] = rlen;
            route.root = s.route_roots[count][0..rlen];
        }

        out_routes[count] = route;
        count += 1;
        i = obj_end;
    }
    return count;
}

fn extractField(obj: []const u8, key: []const u8) ?[]const u8 {
    // Find "<key>" : "<value>"
    var search_buf: [64]u8 = undefined;
    const needle = std.fmt.bufPrint(&search_buf, "\"{s}\"", .{key}) catch return null;
    const k_pos = std.mem.indexOf(u8, obj, needle) orelse return null;
    var p = k_pos + needle.len;
    while (p < obj.len and (obj[p] == ' ' or obj[p] == ':')) p += 1;
    if (p >= obj.len or obj[p] != '"') return null;
    p += 1;
    const start = p;
    while (p < obj.len and obj[p] != '"') {
        if (obj[p] == '\\') p += 1;
        p += 1;
    }
    if (p >= obj.len) return null;
    return obj[start..p];
}

// ── Host callbacks ─────────────────────────────────────────────────

fn hostListen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 3) return;
    const host = v8_runtime.hostContext(info.getIsolate());
    const id = argToU32(info, 0) orelse return;
    const port = argToU32(info, 1) orelse return;
    const routes_json = argToStringAlloc(info, 2) orelse return;
    defer alloc.free(routes_json);

    if (findServer(id) != null) return; // already listening

    const srv = alloc.create(httpserver.HttpServer) catch return;
    var entry = Server{ .id = id, .server = srv };

    var route_buf: [16]httpserver.Route = undefined;
    const rcount = parseRoutes(&entry, routes_json, &route_buf);

    srv.listen(alloc, host.io, host.environ, @intCast(port), route_buf[0..rcount]) catch {
        alloc.destroy(srv);
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "httpsrv:error:{d}", .{id}) catch return;
        emitEvent(host, chan, "{\"error\":\"listen failed\"}");
        return;
    };

    g_servers.append(alloc, entry) catch {
        srv.close();
        alloc.destroy(srv);
        return;
    };
}

fn hostRespond(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 5) return;
    const id = argToU32(info, 0) orelse return;
    const client_id = argToU32(info, 1) orelse return;
    const status = argToU32(info, 2) orelse return;
    const ctype = argToStringAlloc(info, 3) orelse return;
    defer alloc.free(ctype);
    const body = argToStringAlloc(info, 4) orelse return;
    defer alloc.free(body);

    const s = findServer(id) orelse return;
    s.server.respond(client_id, @intCast(status), ctype, body);
}

fn hostClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const id = argToU32(info, 0) orelse return;
    removeServer(id);
}

// ── Tick drain ─────────────────────────────────────────────────────

// Module-static. HttpEvent is ~9KB each, payload is 16KB; keeping these on the
// native stack would eat into V8's call-stack budget and __jsTick would trip
// "Maximum call stack size exceeded" before the event handler even runs.
var g_http_ev_buf: [16]httpserver.HttpEvent = undefined;
// Must hold the emitted JSON: clientId + method + path + JSON-escaped body.
// The body can now be up to MAX_REQ (256 KB); escaping is ~1.1× for typical
// JSON but can expand control chars to \u00XX (6×), so size generously.
var g_http_payload: [1572864]u8 = undefined;

pub fn tickDrain(host: *HostContext) void {
    const ev_buf = &g_http_ev_buf;
    for (g_servers.items) |*s| {
        const n = s.server.update(ev_buf);
        for (ev_buf[0..n]) |*ev| {
            // Emit JSON: {"clientId":N,"method":"...","path":"...","body":"..."}
            const payload = &g_http_payload;
            var pos: usize = 0;
            const head = std.fmt.bufPrint(payload[pos..], "{{\"clientId\":{d},\"method\":\"", .{ev.client_id}) catch continue;
            pos += head.len;
            pos += jsonEscape(ev.methodSlice(), payload[pos..]);
            const mid = std.fmt.bufPrint(payload[pos..], "\",\"path\":\"", .{}) catch continue;
            pos += mid.len;
            pos += jsonEscape(ev.pathSlice(), payload[pos..]);
            const mid2 = std.fmt.bufPrint(payload[pos..], "\",\"body\":\"", .{}) catch continue;
            pos += mid2.len;
            pos += jsonEscape(ev.bodySlice(), payload[pos..]);
            const tail = std.fmt.bufPrint(payload[pos..], "\"}}", .{}) catch continue;
            pos += tail.len;

            var chan_buf: [64]u8 = undefined;
            const chan = std.fmt.bufPrint(&chan_buf, "httpsrv:request:{d}", .{s.id}) catch continue;
            emitEvent(host, chan, payload[0..pos]);
        }
    }
}

// ── Registration ───────────────────────────────────────────────────

pub fn registerHttpServer(_: anytype) void {
    v8_runtime.registerHostFn("__httpsrv_listen", hostListen);
    v8_runtime.registerHostFn("__httpsrv_respond", hostRespond);
    v8_runtime.registerHostFn("__httpsrv_close", hostClose);
}
