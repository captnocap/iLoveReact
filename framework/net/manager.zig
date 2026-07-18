//! Network Manager — connection registry with auto-reconnect and .onion routing.
//!
//! Port of love2d/lua/network.lua. Central registry for WebSocket connections
//! with automatic reconnection backoff and Tor proxy detection for .onion hosts.
//!
//! Usage:
//!   net.init();
//!   net.connect(io, 1, "ws://echo.example.com/ws", .{});
//!   net.connect(io, 2, "ws://hidden.onion/chat", .{ .reconnect = true });
//!   // each frame:
//!   var events: [32]net.NetEvent = undefined;
//!   const n = net.poll(io, &events);
//!   for (events[0..n]) |ev| { ... }
//!   net.send(1, "hello");
//!   net.close(io, 1);
//!   // on shutdown:
//!   net.destroy(io);

const std = @import("std");
const websocket = @import("websocket.zig");
const socks5 = @import("socks5.zig");

// ── Configuration ────────────────────────────────────────────────────────

const MAX_CONNECTIONS = 32;
const MAX_URL = 512;
const MAX_MSG = 65536;
const MAX_EVENTS = 64;
const INITIAL_BACKOFF_MS: u32 = 1000;
const MAX_BACKOFF_MS: u32 = 30000;
const DEFAULT_TOR_PROXY_PORT: u16 = 9050;

// ── Public types ─────────────────────────────────────────────────────────

pub const ConnectOpts = struct {
    reconnect: bool = false,
    tor_proxy_port: u16 = DEFAULT_TOR_PROXY_PORT,
};

pub const NetEventType = enum {
    connected,
    message,
    closed,
    err,
    reconnecting,
};

pub const NetEvent = struct {
    id: u32 = 0,
    event_type: NetEventType = .connected,
    data: [MAX_MSG]u8 = undefined,
    data_len: usize = 0,

    pub fn dataSlice(self: *const NetEvent) []const u8 {
        return self.data[0..self.data_len];
    }
};

const ConnStatus = enum {
    connecting,
    tunneling,
    open,
    reconnecting,
    closed,
};

// Thread-safe connect handoff: mutex protects pending_ws, connect_done, connect_ok.
// Worker locks mutex to publish results. Poll locks mutex to consume them.
// Generation counter prevents stale workers from publishing into reused slots.
const ConnectResult = enum { none, success, failed };

const Connection = struct {
    active: bool = false,
    id: u32 = 0,
    ws: ?websocket.WebSocket = null,
    // Worker → main handoff (protected by mutex)
    pending_ws: ?websocket.WebSocket = null,
    connect_done: bool = false,
    connect_ok: bool = false,
    generation: u32 = 0,
    mutex: std.Io.Mutex = .init,
    // Connection params
    url: [MAX_URL]u8 = undefined,
    url_len: usize = 0,
    host: [256]u8 = undefined,
    host_len: usize = 0,
    port: u16 = 80,
    path: [256]u8 = undefined,
    path_len: usize = 0,
    status: ConnStatus = .closed,
    reconnect: bool = false,
    backoff_ms: u32 = INITIAL_BACKOFF_MS,
    next_retry_tick: u32 = 0,
    is_onion: bool = false,
    tor_proxy_port: u16 = DEFAULT_TOR_PROXY_PORT,
};

// Worker receives a copy of everything it needs — never reads conn.* fields.
const ConnectParams = struct {
    conn: *Connection, // only for mutex-protected publish
    gen: u32,
    host: [256]u8,
    host_len: usize,
    port: u16,
    path: [256]u8,
    path_len: usize,
    is_onion: bool,
    tor_proxy_port: u16,
    io: std.Io,
};

// ── Module state ─────────────────────────────────────────────────────────

var connections: [MAX_CONNECTIONS]Connection = [_]Connection{.{}} ** MAX_CONNECTIONS;
var event_queue: [MAX_EVENTS]NetEvent = undefined;
var event_count: usize = 0;
var initialized = false;
var connect_tasks: std.Io.Group = .init;

// ── Public API ───────────────────────────────────────────────────────────

pub fn init() void {
    if (initialized) return;
    for (&connections) |*c| c.active = false;
    event_count = 0;
    connect_tasks = .init;
    initialized = true;
}

/// Open a WebSocket connection. URL format: ws://host:port/path or wss://host:port/path
pub fn connect(io: std.Io, id: u32, url: []const u8, opts: ConnectOpts) void {
    if (!initialized) return;
    const slot = findSlot() orelse return;
    var conn = &connections[slot];
    // Clear any stale handoff state from previous use of this slot
    conn.pending_ws = null;
    conn.connect_done = false;
    conn.connect_ok = false;
    conn.ws = null;
    conn.active = true;
    conn.id = id;
    conn.status = .connecting;
    conn.reconnect = opts.reconnect;
    conn.backoff_ms = INITIAL_BACKOFF_MS;
    conn.tor_proxy_port = opts.tor_proxy_port;

    // Store URL
    const ulen = @min(url.len, MAX_URL);
    @memcpy(conn.url[0..ulen], url[0..ulen]);
    conn.url_len = ulen;

    // Parse URL
    parseUrl(conn, url[0..ulen]);

    // Detect .onion
    conn.is_onion = isOnion(conn.host[0..conn.host_len]);

    // Initiate connection
    startConnection(io, conn);
}

/// Send data on a connection.
pub fn sendMsg(id: u32, data: []const u8) void {
    if (findById(id)) |conn| {
        if (conn.status == .open) {
            if (conn.ws) |*ws| {
                ws.send(data) catch {};
            }
        }
    }
}

/// Close a connection. Bumps generation to invalidate any in-flight worker.
pub fn closeConn(io: std.Io, id: u32) void {
    if (findById(id)) |conn| {
        conn.mutex.lockUncancelable(io);
        conn.reconnect = false;
        conn.generation +%= 1; // invalidate any in-flight worker
        // Clear pending handoff state
        if (conn.pending_ws) |*pws| pws.shutdown();
        conn.pending_ws = null;
        conn.connect_done = false;
        conn.connect_ok = false;
        if (conn.ws) |*ws| ws.shutdown();
        conn.ws = null;
        conn.status = .closed;
        conn.active = false;
        conn.mutex.unlock(io);
    }
}

/// Poll for events. Call once per frame. Returns count of events.
pub fn poll(io: std.Io, out: []NetEvent) usize {
    if (!initialized) return 0;
    event_count = 0;

    for (&connections) |*conn| {
        if (!conn.active) continue;

        // Check for connect worker completion (mutex-protected handoff)
        var connect_result: ConnectResult = .none;
        {
            conn.mutex.lockUncancelable(io);
            defer conn.mutex.unlock(io);
            if (conn.connect_done) {
                conn.connect_done = false;
                if (conn.connect_ok) {
                    conn.ws = conn.pending_ws;
                    conn.pending_ws = null;
                    conn.status = .connecting;
                    connect_result = .success;
                } else {
                    connect_result = .failed;
                }
            }
        }
        if (connect_result == .failed) {
            handleDisconnect(io, conn);
            continue;
        }

        switch (conn.status) {
            .open, .connecting => {
                if (conn.ws) |*ws| {
                    var safety: u32 = 0;
                    while (safety < 100) : (safety += 1) {
                        if (ws.update()) |event| {
                            switch (event) {
                                .open => {
                                    conn.status = .open;
                                    conn.backoff_ms = INITIAL_BACKOFF_MS;
                                    pushEvent(out, conn.id, .connected, "");
                                },
                                .message => |msg| pushEvent(out, conn.id, .message, msg),
                                .close => |cl| {
                                    pushEvent(out, conn.id, .closed, cl.reason);
                                    handleDisconnect(io, conn);
                                },
                                .err => |e| {
                                    pushEvent(out, conn.id, .err, e);
                                    handleDisconnect(io, conn);
                                },
                            }
                        } else break;
                    }
                }
            },
            .reconnecting => {
                const now = getTicks(io);
                if (now >= conn.next_retry_tick) {
                    pushEvent(out, conn.id, .reconnecting, "");
                    startConnection(io, conn);
                }
            },
            .closed, .tunneling => {},
        }
    }

    return @min(event_count, out.len);
}

/// Shutdown all connections and cancel every in-flight connect task.
pub fn destroy(io: std.Io) void {
    if (!initialized) return;
    for (&connections) |*conn| {
        conn.mutex.lockUncancelable(io);
        conn.generation +%= 1;
        // Clear pending handoff state
        if (conn.pending_ws) |*pws| pws.shutdown();
        conn.pending_ws = null;
        conn.connect_done = false;
        conn.connect_ok = false;
        if (conn.active) {
            if (conn.ws) |*ws| ws.shutdown();
            conn.ws = null;
            conn.active = false;
        }
        conn.mutex.unlock(io);
    }
    connect_tasks.cancel(io);
    initialized = false;
}

// ── Internal ─────────────────────────────────────────────────────────────

fn findSlot() ?usize {
    for (0..MAX_CONNECTIONS) |i| {
        if (!connections[i].active) return i;
    }
    return null;
}

fn findById(id: u32) ?*Connection {
    for (&connections) |*conn| {
        if (conn.active and conn.id == id) return conn;
    }
    return null;
}

fn startConnection(io: std.Io, conn: *Connection) void {
    // Build params struct with COPIES of all data the worker needs.
    // Worker never reads conn.* fields — only uses conn pointer for
    // mutex-protected publish at the end.
    var params = ConnectParams{
        .conn = conn,
        .gen = conn.generation,
        .host = undefined,
        .host_len = conn.host_len,
        .port = conn.port,
        .path = undefined,
        .path_len = conn.path_len,
        .is_onion = conn.is_onion,
        .tor_proxy_port = conn.tor_proxy_port,
        .io = io,
    };
    @memcpy(params.host[0..conn.host_len], conn.host[0..conn.host_len]);
    @memcpy(params.path[0..conn.path_len], conn.path[0..conn.path_len]);

    conn.status = .connecting;
    connect_tasks.concurrent(io, connectWorker, .{params}) catch {
        handleDisconnect(io, conn);
    };
}

fn connectWorker(params: ConnectParams) std.Io.Cancelable!void {
    // Worker thread: blocking TCP/SOCKS5 connect using COPIED params.
    // Only touches conn.* under mutex for publish. No shared mutable state.
    const host = params.host[0..params.host_len];
    const path = params.path[0..params.path_len];
    const conn = params.conn;

    var new_ws: ?websocket.WebSocket = null;

    if (params.is_onion) {
        const stream = socks5.connect(params.io, "127.0.0.1", params.tor_proxy_port, host, params.port, null, null) catch |err| {
            if (err == error.Canceled) return error.Canceled;
            publishResult(params.io, conn, params.gen, null, false);
            return;
        };
        new_ws = websocket.WebSocket.connectViaStream(std.heap.c_allocator, params.io, stream, host, params.port, path) catch |err| {
            if (err == error.Canceled) return error.Canceled;
            publishResult(params.io, conn, params.gen, null, false);
            return;
        };
    } else {
        new_ws = websocket.WebSocket.connectTcp(std.heap.c_allocator, params.io, host, params.port, path) catch |err| {
            if (err == error.Canceled) return error.Canceled;
            publishResult(params.io, conn, params.gen, null, false);
            return;
        };
    }

    publishResult(params.io, conn, params.gen, new_ws, true);
}

/// Mutex-protected publish. Checks generation under lock — if stale,
/// cleans up the WebSocket without touching the slot.
fn publishResult(io: std.Io, conn: *Connection, expected_gen: u32, new_ws: ?websocket.WebSocket, ok: bool) void {
    conn.mutex.lockUncancelable(io);
    defer conn.mutex.unlock(io);
    if (conn.generation == expected_gen) {
        // Slot still belongs to us — publish
        conn.pending_ws = new_ws;
        conn.connect_done = true;
        conn.connect_ok = ok;
    } else {
        // Stale: slot was reused or closed. Clean up without touching slot.
        if (new_ws) |ws| {
            var ws_copy = ws;
            ws_copy.shutdown();
        }
    }
}

fn handleDisconnect(io: std.Io, conn: *Connection) void {
    if (conn.ws) |*ws| ws.shutdown(); // close the underlying stream
    conn.ws = null;
    if (conn.reconnect) {
        conn.status = .reconnecting;
        conn.next_retry_tick = getTicks(io) + conn.backoff_ms;
        conn.backoff_ms = @min(conn.backoff_ms * 2, MAX_BACKOFF_MS);
    } else {
        conn.status = .closed;
        conn.active = false;
    }
}

fn pushEvent(out: []NetEvent, id: u32, event_type: NetEventType, data: []const u8) void {
    if (event_count >= out.len) return;
    var ev = &out[event_count];
    ev.id = id;
    ev.event_type = event_type;
    const dlen = @min(data.len, MAX_MSG);
    if (dlen > 0) @memcpy(ev.data[0..dlen], data[0..dlen]);
    ev.data_len = dlen;
    event_count += 1;
}

fn parseUrl(conn: *Connection, url: []const u8) void {
    // Skip ws:// or wss://
    var start: usize = 0;
    if (url.len > 5 and std.mem.eql(u8, url[0..5], "ws://")) {
        start = 5;
        conn.port = 80;
    } else if (url.len > 6 and std.mem.eql(u8, url[0..6], "wss://")) {
        start = 6;
        conn.port = 443;
    }

    // Find host end (: or / or end)
    var host_end = start;
    while (host_end < url.len and url[host_end] != ':' and url[host_end] != '/') : (host_end += 1) {}
    const hlen = host_end - start;
    @memcpy(conn.host[0..hlen], url[start..host_end]);
    conn.host_len = hlen;

    // Port
    if (host_end < url.len and url[host_end] == ':') {
        host_end += 1;
        var port_end = host_end;
        while (port_end < url.len and url[port_end] != '/') : (port_end += 1) {}
        conn.port = std.fmt.parseInt(u16, url[host_end..port_end], 10) catch conn.port;
        host_end = port_end;
    }

    // Path
    if (host_end < url.len and url[host_end] == '/') {
        const plen = url.len - host_end;
        @memcpy(conn.path[0..plen], url[host_end..url.len]);
        conn.path_len = plen;
    } else {
        conn.path[0] = '/';
        conn.path_len = 1;
    }
}

fn isOnion(host: []const u8) bool {
    return host.len > 6 and std.mem.eql(u8, host[host.len - 6 ..], ".onion");
}

fn getTicks(io: std.Io) u32 {
    const ms = std.Io.Clock.now(.awake, io).toMilliseconds();
    return @truncate(@as(u64, @bitCast(ms)));
}

test "public network manager API compiles" {
    std.testing.refAllDecls(@This());
}
