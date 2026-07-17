//! Network Manager — connection registry with auto-reconnect and .onion routing.
//!
//! Port of love2d/lua/network.lua. Central registry for WebSocket connections
//! with automatic reconnection backoff and Tor proxy detection for .onion hosts.
//!
//! Usage:
//!   net.init();
//!   net.connect(1, "ws://echo.example.com/ws", .{});
//!   net.connect(2, "ws://hidden.onion/chat", .{ .reconnect = true });
//!   // each frame:
//!   var events: [32]net.NetEvent = undefined;
//!   const n = net.poll(&events);
//!   for (events[0..n]) |ev| { ... }
//!   net.send(1, "hello");
//!   net.close(1);
//!   // on shutdown:
//!   net.destroy();

const std = @import("std");
// ZIG_016_MIGRATION §6 exemption (door b): readiness-loop layer, raw
// posix-shaped syscalls via sysx. Do NOT migrate to std.Io.net.
const sysx = @import("sysx.zig");
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
    mutex: std.Thread.Mutex = .{},
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
};

// ── Module state ─────────────────────────────────────────────────────────

var connections: [MAX_CONNECTIONS]Connection = [_]Connection{.{}} ** MAX_CONNECTIONS;
var event_queue: [MAX_EVENTS]NetEvent = undefined;
var event_count: usize = 0;
var active_workers: u32 = 0; // atomic count of in-flight connect threads
var initialized = false;

// ── Public API ───────────────────────────────────────────────────────────

pub fn init() void {
    if (initialized) return;
    for (&connections) |*c| c.active = false;
    event_count = 0;
    initialized = true;
}

/// Open a WebSocket connection. URL format: ws://host:port/path or wss://host:port/path
pub fn connect(id: u32, url: []const u8, opts: ConnectOpts) void {
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
    startConnection(conn);
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
pub fn closeConn(id: u32) void {
    if (findById(id)) |conn| {
        conn.mutex.lock();
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
        conn.mutex.unlock();
    }
}

/// Poll for events. Call once per frame. Returns count of events.
pub fn poll(out: []NetEvent) usize {
    event_count = 0;

    for (&connections) |*conn| {
        if (!conn.active) continue;

        // Check for connect worker completion (mutex-protected handoff)
        var connect_result: ConnectResult = .none;
        {
            conn.mutex.lock();
            defer conn.mutex.unlock();
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
            handleDisconnect(conn);
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
                                    handleDisconnect(conn);
                                },
                                .err => |e| {
                                    pushEvent(out, conn.id, .err, e);
                                    handleDisconnect(conn);
                                },
                            }
                        } else break;
                    }
                }
            },
            .reconnecting => {
                const now = getTicks();
                if (now >= conn.next_retry_tick) {
                    pushEvent(out, conn.id, .reconnecting, "");
                    startConnection(conn);
                }
            },
            .closed, .tunneling => {},
        }
    }

    return @min(event_count, out.len);
}

/// Shutdown all connections. Bumps generations, waits for in-flight threads.
/// Best-effort wait: blocks up to 5s for workers, then returns regardless.
/// Workers that finish after destroy() will see stale generation and clean up.
pub fn destroy() void {
    for (&connections) |*conn| {
        conn.mutex.lock();
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
        conn.mutex.unlock();
    }
    // Best-effort wait for in-flight threads (max 5s)
    var wait_count: u32 = 0;
    while (@atomicLoad(u32, &active_workers, .seq_cst) > 0 and wait_count < 5000) : (wait_count += 1) {
        std.Thread.sleep(1_000_000); // 1ms
    }
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

fn startConnection(conn: *Connection) void {
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
    };
    @memcpy(params.host[0..conn.host_len], conn.host[0..conn.host_len]);
    @memcpy(params.path[0..conn.path_len], conn.path[0..conn.path_len]);

    conn.status = .connecting;
    _ = @atomicRmw(u32, &active_workers, .Add, 1, .seq_cst);
    _ = std.Thread.spawn(.{ .stack_size = 1024 * 1024 }, connectWorker, .{params}) catch {
        _ = @atomicRmw(u32, &active_workers, .Sub, 1, .seq_cst);
        handleDisconnect(conn);
    };
}

fn connectWorker(params: ConnectParams) void {
    // Worker thread: blocking TCP/SOCKS5 connect using COPIED params.
    // Only touches conn.* under mutex for publish. No shared mutable state.
    defer _ = @atomicRmw(u32, &active_workers, .Sub, 1, .seq_cst);

    const host = params.host[0..params.host_len];
    const path = params.path[0..params.path_len];
    const conn = params.conn;

    var new_ws: ?websocket.WebSocket = null;

    if (params.is_onion) {
        const stream = socks5.connect("127.0.0.1", params.tor_proxy_port, host, params.port, null, null) catch {
            publishResult(conn, params.gen, null, false);
            return;
        };
        new_ws = websocket.WebSocket.connectViaStream(stream, host, params.port, path) catch {
            stream.close();
            publishResult(conn, params.gen, null, false);
            return;
        };
    } else {
        new_ws = websocket.WebSocket.connectTcp(host, params.port, path) catch {
            publishResult(conn, params.gen, null, false);
            return;
        };
    }

    publishResult(conn, params.gen, new_ws, true);
}

/// Mutex-protected publish. Checks generation under lock — if stale,
/// cleans up the WebSocket without touching the slot.
fn publishResult(conn: *Connection, expected_gen: u32, new_ws: ?websocket.WebSocket, ok: bool) void {
    conn.mutex.lock();
    defer conn.mutex.unlock();
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

fn handleDisconnect(conn: *Connection) void {
    if (conn.ws) |*ws| ws.shutdown(); // close the underlying stream
    conn.ws = null;
    if (conn.reconnect) {
        conn.status = .reconnecting;
        conn.next_retry_tick = getTicks() + conn.backoff_ms;
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

fn getTicks() u32 {
    // Use SDL_GetTicks if available, otherwise monotonic clock
    const ns = std.time.Instant.now() catch return 0;
    _ = ns;
    // Fallback: use a simple timestamp
    var ts: sysx.timespec = undefined;
    sysx.clock_gettime(.MONOTONIC, &ts);
    return @intCast(@as(u64, @intCast(ts.sec)) * 1000 + @as(u64, @intCast(ts.nsec)) / 1_000_000);
}
