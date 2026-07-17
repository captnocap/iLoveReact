//! WebSocket host bindings — V8 FFI bridge for framework/net/websocket.zig.
//!
//! JS surface (mirrors runtime/hooks/websocket.ts):
//!   __ws_open(id, url)   — initiate connection
//!   __ws_send(id, data)  — send text frame
//!   __ws_close(id)       — close connection
//!
//! Events are delivered via __ffiEmit so the JS shim doesn't need persistent
//! callback handles:
//!   __ffiEmit('ws:open:<id>', '{}')
//!   __ffiEmit('ws:message:<id>', data)
//!   __ffiEmit('ws:close:<id>', '{"code":N,"reason":"..."}')
//!   __ffiEmit('ws:error:<id>', message)

const std = @import("std");
const netx = @import("net/netx.zig");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const websocket = @import("net/websocket.zig");

const alloc = std.heap.c_allocator;

// ── Connection registry ────────────────────────────────────────────

const Conn = struct {
    id: u32,
    ws: websocket.WebSocket,
};

var g_conns: std.ArrayList(Conn) = undefined;

fn ensureConns() void {
    if (g_conns.items.len == 0 and g_conns.capacity == 0) {
        // Lazy init: first use triggers capacity allocation.
        // In Zig 0.15, ArrayList is initialized with .{} and methods take allocator.
    }
}

fn findConn(id: u32) ?*Conn {
    ensureConns();
    for (g_conns.items) |*c| {
        if (c.id == id) return c;
    }
    return null;
}

fn removeConn(id: u32) void {
    var i: usize = g_conns.items.len;
    while (i > 0) {
        i -= 1;
        if (g_conns.items[i].id == id) {
            g_conns.items[i].ws.shutdown();
            _ = g_conns.orderedRemove(i);
            return;
        }
    }
}

// ── URL parsing (ws:// only, no TLS) ───────────────────────────────

const ParsedUrl = struct {
    host: []const u8,
    port: u16,
    path: []const u8,
};

fn parseWsUrl(url: []const u8) ?ParsedUrl {
    const prefix = "ws://";
    if (!std.mem.startsWith(u8, url, prefix)) return null;
    const rest = url[prefix.len..];
    if (rest.len == 0) return null;

    // Find path
    const path_start = std.mem.indexOf(u8, rest, "/");
    const host_port = if (path_start) |ps| rest[0..ps] else rest;
    const path = if (path_start) |ps| rest[ps..] else "/";

    // Find port
    const port_start = std.mem.indexOf(u8, host_port, ":");
    const host = if (port_start) |ps| host_port[0..ps] else host_port;
    const port: u16 = if (port_start) |ps| std.fmt.parseInt(u16, host_port[ps + 1 ..], 10) catch 80 else 80;

    if (host.len == 0) return null;
    return .{ .host = host, .port = port, .path = path };
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

// Reuse isolate from v8_runtime globals for callbacks
var g_iso_for_emit: ?v8.Isolate = null;
var g_ctx_for_emit: ?v8.Context = null;

fn ensureEmitContext() void {
    if (g_iso_for_emit == null) {
        // v8_runtime keeps its isolate/context alive for the session.
        // We'll grab them lazily on first emit; they're stable pointers.
        // Access via v8_runtime's globals isn't exported, so we rely on
        // the fact that __ffiEmit is already installed by JS and we can
        // call it through v8_runtime.callGlobal2Str.
    }
}

fn emitEvent(channel: []const u8, payload: []const u8) void {
    // Build nul-terminated strings for v8_runtime.callGlobal2Str
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

// ── Host callbacks ─────────────────────────────────────────────────

fn hostWsOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = info.getArg(0).toI32(info.getIsolate().getCurrentContext()) catch return;
    if (id < 0) return;
    const url = argToStringAlloc(info, 1) orelse return;
    defer alloc.free(url);

    const parsed = parseWsUrl(url) orelse {
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "ws:error:{d}", .{@as(u32, @intCast(id))}) catch return;
        emitEvent(chan, "invalid ws:// URL");
        return;
    };

    const stream = netx.tcpConnectToHost(alloc, parsed.host, parsed.port) catch |e| {
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "ws:error:{d}", .{@as(u32, @intCast(id))}) catch return;
        var msg_buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "tcp connect failed: {s}", .{@errorName(e)}) catch return;
        emitEvent(chan, msg);
        return;
    };

    const ws = websocket.WebSocket.init(stream, parsed.host, parsed.port, parsed.path) catch |e| {
        stream.close();
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "ws:error:{d}", .{@as(u32, @intCast(id))}) catch return;
        var msg_buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "ws handshake failed: {s}", .{@errorName(e)}) catch return;
        emitEvent(chan, msg);
        return;
    };

    g_conns.append(alloc, .{ .id = @intCast(id), .ws = ws }) catch {
        // If append fails, clean up the socket.
        var c = Conn{ .id = @intCast(id), .ws = ws };
        c.ws.shutdown();
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "ws:error:{d}", .{@as(u32, @intCast(id))}) catch return;
        emitEvent(chan, "out of memory");
        return;
    };
}

fn hostWsSend(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = info.getArg(0).toI32(info.getIsolate().getCurrentContext()) catch return;
    if (id < 0) return;
    const data = argToStringAlloc(info, 1) orelse return;
    defer alloc.free(data);

    const conn = findConn(@intCast(id)) orelse return;
    conn.ws.send(data) catch |e| {
        var chan_buf: [64]u8 = undefined;
        const chan = std.fmt.bufPrint(&chan_buf, "ws:error:{d}", .{@as(u32, @intCast(id))}) catch return;
        var msg_buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "send failed: {s}", .{@errorName(e)}) catch return;
        emitEvent(chan, msg);
    };
}

fn hostWsClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const id = info.getArg(0).toI32(info.getIsolate().getCurrentContext()) catch return;
    if (id < 0) return;

    const conn = findConn(@intCast(id)) orelse return;
    conn.ws.close();
    // Don't remove from registry yet — let tick drain see the close event
    // and emit ws:close before cleanup. If the socket goes straight to closed,
    // tickDrain will catch it next frame.
}

// ── Tick drain (called each frame from appTick) ────────────────────

fn emitWsOpen(id: u32) void {
    var chan_buf: [64]u8 = undefined;
    const chan = std.fmt.bufPrint(&chan_buf, "ws:open:{d}", .{id}) catch return;
    emitEvent(chan, "{}");
}

fn emitWsMessage(id: u32, data: []const u8) void {
    var chan_buf: [64]u8 = undefined;
    const chan = std.fmt.bufPrint(&chan_buf, "ws:message:{d}", .{id}) catch return;
    emitEvent(chan, data);
}

fn emitWsClose(id: u32, code: u16, reason: []const u8) void {
    var chan_buf: [64]u8 = undefined;
    const chan = std.fmt.bufPrint(&chan_buf, "ws:close:{d}", .{id}) catch return;
    var payload_buf: [512]u8 = undefined;
    const payload = std.fmt.bufPrint(&payload_buf, "{{\"code\":{d},\"reason\":\"{s}\"}}", .{ code, reason }) catch return;
    emitEvent(chan, payload);
}

fn emitWsError(id: u32, msg: []const u8) void {
    var chan_buf: [64]u8 = undefined;
    const chan = std.fmt.bufPrint(&chan_buf, "ws:error:{d}", .{id}) catch return;
    emitEvent(chan, msg);
}

pub fn tickDrain() void {
    var i: usize = 0;
    while (i < g_conns.items.len) {
        var conn = &g_conns.items[i];
        const prev_status = conn.ws.status;

        while (conn.ws.update()) |event| {
            switch (event) {
                .open => emitWsOpen(conn.id),
                .message => |msg| emitWsMessage(conn.id, msg),
                .close => |c| {
                    emitWsClose(conn.id, c.code, c.reason);
                    conn.ws.shutdown();
                    _ = g_conns.orderedRemove(i);
                    // Don't increment i; next element shifted into i.
                    break;
                },
                .err => |msg| {
                    emitWsError(conn.id, msg);
                    conn.ws.shutdown();
                    _ = g_conns.orderedRemove(i);
                    break;
                },
            }
        } else {
            // No event from update(). Check if the socket transitioned to closed
            // without emitting an event (e.g., immediate error during init).
            if (prev_status != .closed and conn.ws.status == .closed) {
                _ = g_conns.orderedRemove(i);
                continue;
            }
            i += 1;
        }
    }
}

// ── Registration ───────────────────────────────────────────────────

pub fn registerWebSocket(_: anytype) void {
    v8_runtime.registerHostFn("__ws_open", hostWsOpen);
    v8_runtime.registerHostFn("__ws_send", hostWsSend);
    v8_runtime.registerHostFn("__ws_close", hostWsClose);
}
