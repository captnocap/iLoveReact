//! WebSocket server host bindings — V8 FFI bridge for framework/net/wsserver.zig.
//!
//! JS surface (mirrors runtime/hooks/useHost.ts kind:'ws'):
//!   __wssrv_listen(id, port)
//!   __wssrv_send(id, clientId, data)
//!   __wssrv_broadcast(id, data)
//!   __wssrv_close(id)
//!
//! Events fire via __ffiEmit each frame (tickDrain):
//!   __ffiEmit('wssrv:open:<id>', '{"clientId":N}')
//!   __ffiEmit('wssrv:message:<id>', '{"clientId":N,"data":"..."}')
//!   __ffiEmit('wssrv:close:<id>', '{"clientId":N}')

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const wsserver = @import("net/wsserver.zig");

const alloc = std.heap.c_allocator;

// WsServer is ~8MB — must heap-alloc + use listenInPlace, never return-by-value.
const Server = struct {
    id: u32,
    server: *wsserver.WsServer,
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

fn emitEvent(channel: []const u8, payload: []const u8) void {
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

    v8_runtime.callGlobal2Str("__ffiEmit", chan_z, payload_z);
}

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

// ── Host callbacks ─────────────────────────────────────────────────

fn hostListen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = argToU32(info, 0) orelse return;
    const port = argToU32(info, 1) orelse return;

    if (findServer(id) != null) return;

    const srv = alloc.create(wsserver.WsServer) catch return;
    // Zero-init in place (avoid huge struct literal on stack)
    srv.* = std.mem.zeroes(wsserver.WsServer);
    srv.listenInPlace(@intCast(port)) catch {
        alloc.destroy(srv);
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "wssrv:error:{d}", .{id}) catch return;
        emitEvent(chan, "{\"error\":\"listen failed\"}");
        return;
    };

    g_servers.append(alloc, .{ .id = id, .server = srv }) catch {
        srv.close();
        alloc.destroy(srv);
        return;
    };
}

fn hostSend(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 3) return;
    const id = argToU32(info, 0) orelse return;
    const client_id = argToU32(info, 1) orelse return;
    const data = argToStringAlloc(info, 2) orelse return;
    defer alloc.free(data);

    const s = findServer(id) orelse return;
    s.server.send(client_id, data);
}

fn hostBroadcast(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = argToU32(info, 0) orelse return;
    const data = argToStringAlloc(info, 1) orelse return;
    defer alloc.free(data);

    const s = findServer(id) orelse return;
    s.server.broadcast(data);
}

fn hostClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const id = argToU32(info, 0) orelse return;
    removeServer(id);
}

// ── Tick drain ─────────────────────────────────────────────────────

// Module-static. ServerEvent is ~64KB; keeping this on the native stack would
// eat into V8's call-stack budget and __jsTick trips RangeError. Same reason
// for the per-message JSON payload buffer below.
var g_ev_buf: [4]wsserver.ServerEvent = undefined;
var g_msg_payload: [70_000]u8 = undefined;

pub fn tickDrain() void {
    const ev_buf = &g_ev_buf;
    for (g_servers.items) |*s| {
        // Loop until the server returns 0 events (drain backlog from this frame).
        while (true) {
            const n = s.server.update(ev_buf);
            if (n == 0) break;
            for (ev_buf[0..n]) |*ev| {
                var chan_buf: [64]u8 = undefined;
                switch (ev.event_type) {
                    .client_connected => {
                        const chan = std.fmt.bufPrint(&chan_buf, "wssrv:open:{d}", .{s.id}) catch continue;
                        var pl: [64]u8 = undefined;
                        const p = std.fmt.bufPrint(&pl, "{{\"clientId\":{d}}}", .{ev.client_id}) catch continue;
                        emitEvent(chan, p);
                    },
                    .client_message => {
                        const chan = std.fmt.bufPrint(&chan_buf, "wssrv:message:{d}", .{s.id}) catch continue;
                        const pl = &g_msg_payload;
                        var pos: usize = 0;
                        const head = std.fmt.bufPrint(pl[pos..], "{{\"clientId\":{d},\"data\":\"", .{ev.client_id}) catch continue;
                        pos += head.len;
                        pos += jsonEscape(ev.dataSlice(), pl[pos..]);
                        const tail = std.fmt.bufPrint(pl[pos..], "\"}}", .{}) catch continue;
                        pos += tail.len;
                        emitEvent(chan, pl[0..pos]);
                    },
                    .client_disconnected => {
                        const chan = std.fmt.bufPrint(&chan_buf, "wssrv:close:{d}", .{s.id}) catch continue;
                        var pl: [64]u8 = undefined;
                        const p = std.fmt.bufPrint(&pl, "{{\"clientId\":{d}}}", .{ev.client_id}) catch continue;
                        emitEvent(chan, p);
                    },
                }
            }
            if (n < ev_buf.len) break;
        }
    }
}

// ── Registration ───────────────────────────────────────────────────

pub fn registerWsServer(_: anytype) void {
    v8_runtime.registerHostFn("__wssrv_listen", hostListen);
    v8_runtime.registerHostFn("__wssrv_send", hostSend);
    v8_runtime.registerHostFn("__wssrv_broadcast", hostBroadcast);
    v8_runtime.registerHostFn("__wssrv_close", hostClose);
}
