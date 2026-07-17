//! Game-server protocol bindings — RCON (TCP) + A2S Source Query (UDP).
//!
//! All binary framing happens in the Zig modules; only structured payloads
//! cross the V8 FFI boundary (RCON command output as a UTF-8 string, A2S
//! responses as JSON), which sidesteps V8's UTF-16/8 string round-trip
//! mangling non-UTF-8 protocol bytes.
//!
//! JS surface (mirrors `useConnection({kind:'rcon'|'a2s'})`):
//!   __rcon_open(id, host, port, password)
//!   __rcon_command(id, requestId, cmd) → returns nothing; response fires
//!     on `rcon:response:<id>` with payload `{"requestId":N,"body":"..."}`
//!   __rcon_close(id)
//!   __a2s_open(id, host, port)
//!   __a2s_query(id, "info"|"players"|"rules")
//!   __a2s_close(id)
//!
//! Events:
//!   __ffiEmit('rcon:auth:<id>',    '{"ok":true}'|'{"ok":false}')
//!   __ffiEmit('rcon:response:<id>', '{"requestId":N,"body":"..."}')
//!   __ffiEmit('rcon:close:<id>',    '{}')
//!   __ffiEmit('rcon:error:<id>',    message)
//!   __ffiEmit('a2s:info:<id>',      <info-json>)
//!   __ffiEmit('a2s:players:<id>',   <players-json>)
//!   __ffiEmit('a2s:rules:<id>',     <rules-json>)
//!   __ffiEmit('a2s:error:<id>',     message)

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const rcon_mod = @import("net/rcon.zig");
const a2s_mod = @import("net/a2s.zig");

const alloc = std.heap.c_allocator;

const RconEntry = struct { id: u32, client: *rcon_mod.RconClient };
const A2sEntry = struct { id: u32, client: *a2s_mod.A2sClient };

var g_rcon: std.ArrayList(RconEntry) = .empty;
var g_a2s: std.ArrayList(A2sEntry) = .empty;

fn findRcon(id: u32) ?*RconEntry {
    for (g_rcon.items) |*e| if (e.id == id) return e;
    return null;
}

fn findA2s(id: u32) ?*A2sEntry {
    for (g_a2s.items) |*e| if (e.id == id) return e;
    return null;
}

fn removeRcon(id: u32) void {
    var i: usize = g_rcon.items.len;
    while (i > 0) {
        i -= 1;
        if (g_rcon.items[i].id == id) {
            g_rcon.items[i].client.close(alloc);
            alloc.destroy(g_rcon.items[i].client);
            _ = g_rcon.orderedRemove(i);
            return;
        }
    }
}

fn removeA2s(id: u32) void {
    var i: usize = g_a2s.items.len;
    while (i > 0) {
        i -= 1;
        if (g_a2s.items[i].id == id) {
            g_a2s.items[i].client.close();
            alloc.destroy(g_a2s.items[i].client);
            _ = g_a2s.orderedRemove(i);
            return;
        }
    }
}

// ── Helpers (mirrors v8_bindings_net) ───────────────────────────────

fn argStr(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argU32(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
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

fn jsonEscape(out: *std.ArrayList(u8), s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |c| {
        switch (c) {
            '\\' => try out.appendSlice(alloc, "\\\\"),
            '"' => try out.appendSlice(alloc, "\\\""),
            '\n' => try out.appendSlice(alloc, "\\n"),
            '\r' => try out.appendSlice(alloc, "\\r"),
            '\t' => try out.appendSlice(alloc, "\\t"),
            0...0x08, 0x0B, 0x0C, 0x0E...0x1F => {
                var buf: [8]u8 = undefined;
                const e = try std.fmt.bufPrint(&buf, "\\u{x:0>4}", .{c});
                try out.appendSlice(alloc, e);
            },
            else => try out.append(alloc, c),
        }
    }
    try out.append(alloc, '"');
}

// ── RCON host fns ───────────────────────────────────────────────────

fn hostRconOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 4) return;
    const id = argU32(info, 0) orelse return;
    const host = argStr(info, 1) orelse return;
    defer alloc.free(host);
    const port = argU32(info, 2) orelse return;
    const password = argStr(info, 3) orelse return;
    defer alloc.free(password);

    if (findRcon(id) != null) return;

    const client = alloc.create(rcon_mod.RconClient) catch return;
    client.* = rcon_mod.RconClient.connect(host, @intCast(port), password, alloc) catch |e| {
        alloc.destroy(client);
        var buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&buf, "rcon:error:{d}", .{id}) catch return;
        var msg_buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "connect: {s}", .{@errorName(e)}) catch "connect failed";
        emitEvent(chan, msg);
        return;
    };
    g_rcon.append(alloc, .{ .id = id, .client = client }) catch {
        client.close(alloc);
        alloc.destroy(client);
    };
}

fn hostRconCommand(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 3) return;
    const id = argU32(info, 0) orelse return;
    const req_id_hint = argU32(info, 1) orelse 0;
    const cmd = argStr(info, 2) orelse return;
    defer alloc.free(cmd);

    const e = findRcon(id) orelse return;
    const actual_req_id = e.client.command(cmd) catch {
        // not ready yet — surface as an error so the caller knows the
        // command was dropped (typically: auth hasn't completed).
        var buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&buf, "rcon:error:{d}", .{id}) catch return;
        emitEvent(chan, "command rejected: not authenticated");
        return;
    };
    _ = req_id_hint; // hook bumps its own counter; we use the wire-side one
    _ = actual_req_id; // surfaced via response event
}

fn hostRconClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return;
    removeRcon(id);
}

// ── A2S host fns ────────────────────────────────────────────────────

fn hostA2sOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 3) return;
    const id = argU32(info, 0) orelse return;
    const host = argStr(info, 1) orelse return;
    defer alloc.free(host);
    const port = argU32(info, 2) orelse return;

    if (findA2s(id) != null) return;

    const client = alloc.create(a2s_mod.A2sClient) catch return;
    client.* = a2s_mod.A2sClient.open(host, @intCast(port)) catch |e| {
        alloc.destroy(client);
        var buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&buf, "a2s:error:{d}", .{id}) catch return;
        var msg_buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "open: {s}", .{@errorName(e)}) catch "open failed";
        emitEvent(chan, msg);
        return;
    };
    g_a2s.append(alloc, .{ .id = id, .client = client }) catch {
        client.close();
        alloc.destroy(client);
    };
}

fn hostA2sQuery(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = argU32(info, 0) orelse return;
    const kind = argStr(info, 1) orelse return;
    defer alloc.free(kind);
    const e = findA2s(id) orelse return;
    if (std.mem.eql(u8, kind, "info")) {
        e.client.queryInfo();
    } else if (std.mem.eql(u8, kind, "players")) {
        e.client.queryPlayers();
    } else if (std.mem.eql(u8, kind, "rules")) {
        e.client.queryRules();
    }
}

fn hostA2sClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return;
    removeA2s(id);
}

// ── tickDrain ───────────────────────────────────────────────────────

var g_rcon_ev: [1]rcon_mod.Event = undefined;
var g_a2s_ev: [1]a2s_mod.Event = undefined;

pub fn tickDrain() void {
    var i: usize = 0;
    while (i < g_rcon.items.len) {
        const e = g_rcon.items[i];
        var chan_buf: [64]u8 = undefined;
        while (true) {
            const n = e.client.update(&g_rcon_ev, alloc);
            if (n == 0) break;
            switch (g_rcon_ev[0]) {
                .auth_ok => {
                    const chan = std.fmt.bufPrint(&chan_buf, "rcon:auth:{d}", .{e.id}) catch break;
                    emitEvent(chan, "{\"ok\":true}");
                },
                .auth_fail => {
                    const chan = std.fmt.bufPrint(&chan_buf, "rcon:auth:{d}", .{e.id}) catch break;
                    emitEvent(chan, "{\"ok\":false}");
                },
                .response => |r| {
                    var payload: std.ArrayList(u8) = .empty;
                    defer payload.deinit(alloc);
                    payload.writer(alloc).print("{{\"requestId\":{d},\"body\":", .{r.request_id}) catch {
                        alloc.free(r.body);
                        continue;
                    };
                    jsonEscape(&payload, r.body) catch {
                        alloc.free(r.body);
                        continue;
                    };
                    payload.append(alloc, '}') catch {
                        alloc.free(r.body);
                        continue;
                    };
                    alloc.free(r.body);
                    const chan = std.fmt.bufPrint(&chan_buf, "rcon:response:{d}", .{e.id}) catch continue;
                    emitEvent(chan, payload.items);
                },
                .closed => {
                    const chan = std.fmt.bufPrint(&chan_buf, "rcon:close:{d}", .{e.id}) catch break;
                    emitEvent(chan, "{}");
                    break;
                },
                .err => |msg| {
                    const chan = std.fmt.bufPrint(&chan_buf, "rcon:error:{d}", .{e.id}) catch break;
                    emitEvent(chan, msg);
                    break;
                },
            }
        }
        if (e.client.state == .closed or e.client.state == .errored) {
            removeRcon(e.id);
            continue;
        }
        i += 1;
    }

    var j: usize = 0;
    while (j < g_a2s.items.len) {
        const e = g_a2s.items[j];
        var chan_buf: [64]u8 = undefined;
        while (true) {
            const n = e.client.update(&g_a2s_ev, alloc);
            if (n == 0) break;
            switch (g_a2s_ev[0]) {
                .info_json => |json| {
                    const chan = std.fmt.bufPrint(&chan_buf, "a2s:info:{d}", .{e.id}) catch {
                        alloc.free(json);
                        continue;
                    };
                    emitEvent(chan, json);
                    alloc.free(json);
                },
                .players_json => |json| {
                    const chan = std.fmt.bufPrint(&chan_buf, "a2s:players:{d}", .{e.id}) catch {
                        alloc.free(json);
                        continue;
                    };
                    emitEvent(chan, json);
                    alloc.free(json);
                },
                .rules_json => |json| {
                    const chan = std.fmt.bufPrint(&chan_buf, "a2s:rules:{d}", .{e.id}) catch {
                        alloc.free(json);
                        continue;
                    };
                    emitEvent(chan, json);
                    alloc.free(json);
                },
                .err => |msg| {
                    const chan = std.fmt.bufPrint(&chan_buf, "a2s:error:{d}", .{e.id}) catch break;
                    emitEvent(chan, msg);
                },
            }
        }
        j += 1;
    }
}

// ── Registration ───────────────────────────────────────────────────

pub fn registerGameServer(_: anytype) void {
    v8_runtime.registerHostFn("__rcon_open", hostRconOpen);
    v8_runtime.registerHostFn("__rcon_command", hostRconCommand);
    v8_runtime.registerHostFn("__rcon_close", hostRconClose);
    v8_runtime.registerHostFn("__a2s_open", hostA2sOpen);
    v8_runtime.registerHostFn("__a2s_query", hostA2sQuery);
    v8_runtime.registerHostFn("__a2s_close", hostA2sClose);
}
