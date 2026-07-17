//! TCP bridge to the `browse` Python session (default 127.0.0.1:7331).
//!
//! Protocol: newline-delimited JSON. Send `{"cmd":"navigate","url":"…"}\n`,
//! read one `{"ok":bool,"result":…|"error":"…"}\n` reply, close.
//!
//! One short-lived TCP connection per request. The `browse` session server
//! handles concurrent clients fine, and per-request connect avoids state
//! divergence if the session restarts under us. Throughput is dominated by
//! the underlying Selenium navigation, so the connect overhead is noise.
//!
//! Pairs with v8_bindings_sdk.zig host fns __browse_request_async / _sync /
//! _set_port and runtime/hooks/useBrowse.ts on the JS side.

const std = @import("std");
const RingBuffer = @import("ring_buffer.zig").RingBuffer;

pub const DEFAULT_PORT: u16 = 7331;
const HOST = "127.0.0.1";
const MAX_WORKERS = 2;
const MAX_RESP = 4 * 1024 * 1024; // 4MB cap on response body
const QUEUE_SIZE = 16;

pub const Response = struct {
    id: u32,
    is_error: bool,
    /// Heap-allocated via std.heap.page_allocator. Drainer must free.
    body: []u8,
};

const Request = struct {
    id: u32 = 0,
    /// Heap-allocated via std.heap.page_allocator. Worker frees after sending.
    body: ?[]u8 = null,
    shutdown: bool = false,
};

var request_queue: RingBuffer(Request, QUEUE_SIZE) = .{};
var response_queue: RingBuffer(Response, QUEUE_SIZE) = .{};
var workers: [MAX_WORKERS]?std.Thread = .{ null, null };
var initialized: bool = false;
var port: u16 = DEFAULT_PORT;

pub fn init() void {
    if (initialized) return;
    for (0..MAX_WORKERS) |i| {
        workers[i] = std.Thread.spawn(.{}, workerMain, .{}) catch null;
    }
    initialized = true;
}

pub fn setPort(p: u16) void {
    if (p != 0) port = p;
}

pub fn getPort() u16 {
    return port;
}

/// Enqueue an async request. The body is duped via `alloc` and freed by the
/// worker once the request has been sent. Returns false if the queue is full
/// or duplication failed.
pub fn request(alloc: std.mem.Allocator, id: u32, body: []const u8) bool {
    const owned = alloc.dupe(u8, body) catch return false;
    const req = Request{ .id = id, .body = owned };
    if (!request_queue.push(req)) {
        alloc.free(owned);
        return false;
    }
    return true;
}

/// Synchronous request. Caller frees `Response.body` with std.heap.page_allocator.
pub fn requestSync(body: []const u8) Response {
    return executeRequest(0, body);
}

pub fn poll(out: []Response) usize {
    return response_queue.drain(out);
}

pub fn destroy() void {
    if (!initialized) return;
    var sent: usize = 0;
    while (sent < MAX_WORKERS) {
        const sentinel = Request{ .shutdown = true };
        if (request_queue.push(sentinel)) {
            sent += 1;
        } else {
            std.Thread.sleep(1_000_000);
        }
    }
    for (0..MAX_WORKERS) |i| {
        if (workers[i]) |t| t.join();
        workers[i] = null;
    }
    initialized = false;
}

fn workerMain() void {
    while (true) {
        const req = blk: {
            while (true) {
                if (request_queue.pop()) |item| break :blk item;
                std.Thread.sleep(2_000_000);
            }
        };
        if (req.shutdown) return;
        const body = req.body orelse continue;
        defer std.heap.page_allocator.free(body);

        const resp = executeRequest(req.id, body);
        while (!response_queue.push(resp)) {
            std.Thread.sleep(1_000_000);
        }
    }
}

fn executeRequest(id: u32, body: []const u8) Response {
    const alloc = std.heap.page_allocator;

    const stream = std.net.tcpConnectToHost(alloc, HOST, port) catch |err| {
        return makeErr(id, @errorName(err));
    };
    defer stream.close();

    stream.writeAll(body) catch |err| return makeErr(id, @errorName(err));
    stream.writeAll("\n") catch |err| return makeErr(id, @errorName(err));

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);

    var buf: [8192]u8 = undefined;
    var found_newline = false;
    while (!found_newline and out.items.len < MAX_RESP) {
        const n = stream.read(&buf) catch |err| {
            return makeErr(id, @errorName(err));
        };
        if (n == 0) break;
        const room = MAX_RESP -| out.items.len;
        const take = @min(room, n);
        if (take > 0) {
            out.appendSlice(alloc, buf[0..take]) catch |err| return makeErr(id, @errorName(err));
        }
        if (std.mem.indexOfScalar(u8, buf[0..take], '\n') != null) found_newline = true;
    }

    const slice = out.toOwnedSlice(alloc) catch |err| return makeErr(id, @errorName(err));
    return .{ .id = id, .is_error = false, .body = slice };
}

fn makeErr(id: u32, msg: []const u8) Response {
    const alloc = std.heap.page_allocator;
    const prefix = "{\"ok\":false,\"error\":\"";
    const suffix = "\"}";
    const buf = alloc.alloc(u8, prefix.len + msg.len + suffix.len) catch {
        // page_allocator failing on a sub-page alloc means OOM — fall back
        // to a static literal copy via a fresh attempt; if that also fails
        // we genuinely cannot continue.
        const fallback = "{\"ok\":false,\"error\":\"oom\"}";
        const f = alloc.dupe(u8, fallback) catch unreachable;
        return .{ .id = id, .is_error = true, .body = f };
    };
    @memcpy(buf[0..prefix.len], prefix);
    @memcpy(buf[prefix.len .. prefix.len + msg.len], msg);
    @memcpy(buf[prefix.len + msg.len ..], suffix);
    return .{ .id = id, .is_error = true, .body = buf };
}
