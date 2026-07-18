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
const transport = @import("transport.zig");

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
    allocator: std.mem.Allocator = std.heap.page_allocator,
};

var request_storage: [QUEUE_SIZE]Request = undefined;
var response_storage: [QUEUE_SIZE]Response = undefined;
var request_queue: std.Io.Queue(Request) = .init(&request_storage);
var response_queue: std.Io.Queue(Response) = .init(&response_storage);
var worker_tasks: std.Io.Group = .init;
var initialized: bool = false;
var port: std.atomic.Value(u16) = .init(DEFAULT_PORT);

pub fn init(io: std.Io) !void {
    if (initialized) return;
    request_queue = .init(&request_storage);
    response_queue = .init(&response_storage);
    worker_tasks = .init;
    errdefer worker_tasks.cancel(io);
    for (0..MAX_WORKERS) |_| {
        try worker_tasks.concurrent(io, workerMain, .{io});
    }
    initialized = true;
}

pub fn setPort(p: u16) void {
    if (p != 0) port.store(p, .release);
}

pub fn getPort() u16 {
    return port.load(.acquire);
}

/// Enqueue an async request. The body is duped via `alloc` and freed by the
/// worker once the request has been sent. Returns false if the queue is full
/// or duplication failed.
pub fn request(io: std.Io, alloc: std.mem.Allocator, id: u32, body: []const u8) bool {
    const owned = alloc.dupe(u8, body) catch return false;
    const req = Request{ .id = id, .body = owned, .allocator = alloc };
    if ((request_queue.putUncancelable(io, &.{req}, 0) catch 0) != 1) {
        alloc.free(owned);
        return false;
    }
    return true;
}

/// Synchronous request. Caller frees `Response.body` with std.heap.page_allocator.
pub fn requestSync(io: std.Io, body: []const u8) Response {
    return executeRequest(io, 0, body);
}

pub fn poll(io: std.Io, out: []Response) usize {
    return response_queue.getUncancelable(io, out, 0) catch 0;
}

pub fn destroy(io: std.Io) void {
    if (!initialized) return;
    worker_tasks.cancel(io);

    var requests: [QUEUE_SIZE]Request = undefined;
    const request_count = request_queue.getUncancelable(io, &requests, 0) catch 0;
    for (requests[0..request_count]) |req| if (req.body) |body| req.allocator.free(body);

    var responses: [QUEUE_SIZE]Response = undefined;
    const response_count = response_queue.getUncancelable(io, &responses, 0) catch 0;
    for (responses[0..response_count]) |response| std.heap.page_allocator.free(response.body);

    initialized = false;
}

fn workerMain(io: std.Io) std.Io.Cancelable!void {
    while (true) {
        const req = request_queue.getOne(io) catch |err| switch (err) {
            error.Canceled => return error.Canceled,
            error.Closed => return,
        };
        const body = req.body orelse continue;
        defer req.allocator.free(body);

        const resp = executeRequest(io, req.id, body);
        response_queue.putOne(io, resp) catch |err| {
            std.heap.page_allocator.free(resp.body);
            switch (err) {
                error.Canceled => return error.Canceled,
                error.Closed => return,
            }
        };
    }
}

fn executeRequest(io: std.Io, id: u32, body: []const u8) Response {
    const alloc = std.heap.page_allocator;

    const stream = transport.connectHost(io, HOST, getPort()) catch |err| {
        return makeErr(id, @errorName(err));
    };
    defer stream.close(io);

    var write_backing: [4096]u8 = undefined;
    var writer = stream.writer(io, &write_backing);
    writer.interface.writeAll(body) catch return makeErr(id, @errorName(writer.err orelse error.Unexpected));
    writer.interface.writeByte('\n') catch return makeErr(id, @errorName(writer.err orelse error.Unexpected));
    writer.interface.flush() catch return makeErr(id, @errorName(writer.err orelse error.Unexpected));

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);

    var buf: [8192]u8 = undefined;
    var reader = stream.reader(io, &buf);
    var found_newline = false;
    while (!found_newline and out.items.len < MAX_RESP) {
        reader.interface.fillMore() catch |err| switch (err) {
            error.EndOfStream => break,
            error.ReadFailed => return makeErr(id, @errorName(reader.err orelse error.Unexpected)),
        };
        const available = reader.interface.buffered();
        const room = MAX_RESP -| out.items.len;
        const take = @min(room, available.len);
        if (take > 0) {
            out.appendSlice(alloc, available[0..take]) catch |err| return makeErr(id, @errorName(err));
        }
        if (std.mem.indexOfScalar(u8, available[0..take], '\n') != null) found_newline = true;
        reader.interface.toss(available.len);
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

test "public browse bridge API compiles" {
    std.testing.refAllDecls(@This());
}

test "idle browse workers cancel without sentinels" {
    try init(std.testing.io);
    destroy(std.testing.io);
}
