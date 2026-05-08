//! HTTP/HTTPS client — std.http.Client worker pool with ring buffer communication.
//!
//! Replaces the previous libcurl implementation. Same architecture: worker threads
//! block on client.fetch(), main thread polls responses each frame.
//!
//! Usage from generated code:
//!   const http = @import("net/http.zig");
//!   http.init();
//!   http.request(1, .{ .url = "https://example.com" });
//!   // each frame:
//!   var responses: [16]http.Response = undefined;
//!   const n = http.poll(&responses);
//!   for (responses[0..n]) |resp| { ... }
//!   // on shutdown:
//!   http.destroy();

const std = @import("std");
const RingBuffer = @import("ring_buffer.zig").RingBuffer;

// ── Configuration ────────────────────────────────────────────────────────

const MAX_WORKERS = 4;
const MAX_URL = 2048;
const MAX_HEADERS = 16;
const MAX_HEADER_LEN = 512;
const MAX_REQ_BODY = 16384; // 16KB request body
const MAX_BODY = 65536; // 64KB response body limit
const MAX_ERROR = 256;
const QUEUE_SIZE = 16;

// ── Public types ─────────────────────────────────────────────────────────

pub const Method = enum { GET, POST, PUT, DELETE, PATCH, HEAD };

pub const RequestOpts = struct {
    url: []const u8,
    method: Method = .GET,
    headers: ?[]const [2][]const u8 = null, // key-value pairs
    body: ?[]const u8 = null,
    proxy: ?[]const u8 = null,
    /// Stream the response body as a sequence of `.chunk` Responses followed
    /// by a terminal `.complete` (or `.err`). Each chunk carries up to
    /// MAX_BODY bytes; cap is enforced per-write.
    stream: bool = false,
    /// If non-null, write the response body directly to this filesystem path.
    /// Skips the in-memory body buffer entirely — required for downloads
    /// larger than MAX_BODY (model files, video, etc.). Progress is emitted as
    /// `.progress` Responses (JSON `{"d":bytesDl,"t":0}` in body), and a
    /// terminal `.complete` (with HTTP status) or `.err` follows.
    /// stream and download_to are mutually exclusive — download_to takes precedence.
    download_to: ?[]const u8 = null,
};

pub const ResponseType = enum { complete, chunk, progress, err };

pub const Response = struct {
    id: u32 = 0,
    status: u16 = 0,
    body: [MAX_BODY]u8 = undefined,
    body_len: usize = 0,
    truncated: bool = false, // true if response body exceeded MAX_BODY
    response_type: ResponseType = .complete,
    error_msg: [MAX_ERROR]u8 = undefined,
    error_len: usize = 0,

    pub fn bodySlice(self: *const Response) []const u8 {
        return self.body[0..self.body_len];
    }

    pub fn errorSlice(self: *const Response) []const u8 {
        return self.error_msg[0..self.error_len];
    }
};

// Internal request struct (fixed-size, goes through ring buffer)
const Request = struct {
    id: u32 = 0,
    url: [MAX_URL]u8 = undefined,
    url_len: usize = 0,
    method: Method = .GET,
    header_keys: [MAX_HEADERS][MAX_HEADER_LEN]u8 = undefined,
    header_vals: [MAX_HEADERS][MAX_HEADER_LEN]u8 = undefined,
    header_key_lens: [MAX_HEADERS]usize = undefined,
    header_val_lens: [MAX_HEADERS]usize = undefined,
    header_count: usize = 0,
    body: [MAX_REQ_BODY]u8 = undefined,
    body_len: usize = 0,
    proxy: [MAX_URL]u8 = undefined,
    proxy_len: usize = 0,
    stream: bool = false,
    download_path: [MAX_URL]u8 = undefined,
    download_path_len: usize = 0,
    shutdown: bool = false, // sentinel to tell worker to exit
};

// ── Module state ─────────────────────────────────────────────────────────

var request_queue: RingBuffer(Request, QUEUE_SIZE) = .{};
var response_queue: RingBuffer(Response, QUEUE_SIZE) = .{};
var workers: [MAX_WORKERS]?std.Thread = .{ null, null, null, null };
var initialized = false;

// ── Public API ───────────────────────────────────────────────────────────

/// Initialize the HTTP client. Spawns worker threads.
pub fn init() void {
    if (initialized) return;
    for (0..MAX_WORKERS) |i| {
        workers[i] = std.Thread.spawn(.{}, workerMain, .{}) catch null;
    }
    initialized = true;
}

/// Queue an HTTP request. Non-blocking. Returns false if queue is full.
pub fn request(id: u32, opts: RequestOpts) bool {
    var req = Request{};
    req.id = id;

    // Copy URL
    const url_len = @min(opts.url.len, MAX_URL);
    @memcpy(req.url[0..url_len], opts.url[0..url_len]);
    req.url_len = url_len;

    req.method = opts.method;

    // Copy headers
    if (opts.headers) |hdrs| {
        for (hdrs, 0..) |kv, i| {
            if (i >= MAX_HEADERS) break;
            const klen = @min(kv[0].len, MAX_HEADER_LEN);
            const vlen = @min(kv[1].len, MAX_HEADER_LEN);
            @memcpy(req.header_keys[i][0..klen], kv[0][0..klen]);
            @memcpy(req.header_vals[i][0..vlen], kv[1][0..vlen]);
            req.header_key_lens[i] = klen;
            req.header_val_lens[i] = vlen;
            req.header_count += 1;
        }
    }

    // Copy body
    if (opts.body) |body| {
        const blen = @min(body.len, MAX_REQ_BODY);
        @memcpy(req.body[0..blen], body[0..blen]);
        req.body_len = blen;
    }

    // Copy proxy (explicit — env vars are handled by std.http.Client)
    if (opts.proxy) |proxy| {
        const plen = @min(proxy.len, MAX_URL);
        @memcpy(req.proxy[0..plen], proxy[0..plen]);
        req.proxy_len = plen;
    }

    req.stream = opts.stream;

    if (opts.download_to) |dp| {
        const dlen = @min(dp.len, MAX_URL);
        @memcpy(req.download_path[0..dlen], dp[0..dlen]);
        req.download_path_len = dlen;
    }

    return request_queue.push(req);
}

/// Poll for completed responses. Non-blocking — returns count.
pub fn poll(out: []Response) usize {
    return response_queue.drain(out);
}

/// Shutdown all workers and cleanup.
pub fn destroy() void {
    if (!initialized) return;
    // Send shutdown sentinels — retry until all are queued
    var sent: usize = 0;
    while (sent < MAX_WORKERS) {
        var sentinel = Request{};
        sentinel.shutdown = true;
        if (request_queue.push(sentinel)) {
            sent += 1;
        } else {
            // Queue full — drain responses to make room
            var discard: [16]Response = undefined;
            _ = response_queue.drain(&discard);
            std.Thread.sleep(1_000_000); // 1ms
        }
    }
    // Join all threads
    for (0..MAX_WORKERS) |i| {
        if (workers[i]) |t| t.join();
        workers[i] = null;
    }
    initialized = false;
}

// ── Worker thread ────────────────────────────────────────────────────────

fn workerMain() void {
    const alloc = std.heap.page_allocator;
    var client: std.http.Client = .{ .allocator = alloc };
    defer client.deinit();
    client.initDefaultProxies(alloc) catch {};

    while (true) {
        const req = blk: {
            while (true) {
                if (request_queue.pop()) |r| break :blk r;
                std.Thread.sleep(1_000_000); // 1ms
            }
        };

        if (req.shutdown) return;

        if (req.stream or req.download_path_len > 0) {
            executeStreamOrDownload(&client, &req);
            continue;
        }

        // Execute the request
        var resp = Response{};
        resp.id = req.id;
        executeRequest(&client, &req, &resp) catch |err| {
            resp.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(resp.error_msg[0..elen], msg[0..elen]);
            resp.error_len = elen;
        };
        // Retry push until response is queued (don't drop responses)
        while (!response_queue.push(resp)) {
            std.Thread.sleep(1_000_000); // 1ms backoff
        }
    }
}

fn methodFromReq(req: *const Request) std.http.Method {
    return switch (req.method) {
        .GET => .GET,
        .POST => .POST,
        .PUT => .PUT,
        .DELETE => .DELETE,
        .PATCH => .PATCH,
        .HEAD => .HEAD,
    };
}

fn buildExtraHeaders(req: *const Request) [MAX_HEADERS]std.http.Header {
    var extra_headers: [MAX_HEADERS]std.http.Header = undefined;
    for (0..req.header_count) |i| {
        extra_headers[i] = .{
            .name = req.header_keys[i][0..req.header_key_lens[i]],
            .value = req.header_vals[i][0..req.header_val_lens[i]],
        };
    }
    return extra_headers;
}

fn executeRequest(client: *std.http.Client, req: *const Request, resp: *Response) !void {
    const alloc = std.heap.page_allocator;
    const url = req.url[0..req.url_len];
    const method = methodFromReq(req);
    var extra_headers = buildExtraHeaders(req);
    const payload = if (req.body_len > 0) req.body[0..req.body_len] else null;

    var body_alloc = std.Io.Writer.Allocating.init(alloc);
    defer body_alloc.deinit();

    const result = try client.fetch(.{
        .location = .{ .url = url },
        .method = method,
        .payload = payload,
        .extra_headers = extra_headers[0..req.header_count],
        .response_writer = &body_alloc.writer,
        .keep_alive = false,
        .redirect_behavior = .init(10),
    });

    var body_list = body_alloc.toArrayList();
    defer body_list.deinit(alloc);

    resp.status = @intFromEnum(result.status);
    const body = body_list.items;
    const to_copy = @min(body.len, MAX_BODY);
    if (to_copy > 0) {
        @memcpy(resp.body[0..to_copy], body[0..to_copy]);
    }
    resp.body_len = to_copy;
    resp.truncated = body.len > MAX_BODY;
    resp.response_type = .complete;
}

// ── Streaming ────────────────────────────────────────────────────────────

const StreamWriter = struct {
    req_id: u32,
    interface: std.Io.Writer,

    pub fn init(req_id: u32) StreamWriter {
        return .{
            .req_id = req_id,
            .interface = .{
                .vtable = &.{
                    .drain = drain,
                    .sendFile = std.Io.Writer.unimplementedSendFile,
                },
                .buffer = &.{},
            },
        };
    }

    pub fn drain(io_w: *std.Io.Writer, data: []const []const u8, splat: usize) std.Io.Writer.Error!usize {
        const self: *StreamWriter = @fieldParentPtr("interface", io_w);
        var total: usize = 0;
        var s: usize = 0;
        while (s < splat) : (s += 1) {
            for (data) |slice| {
                total += slice.len;
                var off: usize = 0;
                while (off < slice.len) {
                    var chunk = Response{};
                    chunk.id = self.req_id;
                    chunk.response_type = .chunk;
                    const remaining = slice.len - off;
                    const to_copy = @min(remaining, MAX_BODY);
                    if (to_copy > 0) {
                        @memcpy(chunk.body[0..to_copy], slice[off..off + to_copy]);
                    }
                    chunk.body_len = to_copy;
                    while (!response_queue.push(chunk)) {
                        std.Thread.sleep(1_000_000); // 1ms backoff if queue full
                    }
                    off += to_copy;
                }
            }
        }
        return total;
    }
};

// ── Download ─────────────────────────────────────────────────────────────

const DownloadWriter = struct {
    req_id: u32,
    file: std.fs.File,
    bytes_written: usize = 0,
    last_emit_ms: i64 = 0,
    interface: std.Io.Writer,

    pub fn init(req_id: u32, file: std.fs.File) DownloadWriter {
        return .{
            .req_id = req_id,
            .file = file,
            .interface = .{
                .vtable = &.{
                    .drain = drain,
                    .sendFile = std.Io.Writer.unimplementedSendFile,
                },
                .buffer = &.{},
            },
        };
    }

    pub fn drain(io_w: *std.Io.Writer, data: []const []const u8, splat: usize) std.Io.Writer.Error!usize {
        const self: *DownloadWriter = @fieldParentPtr("interface", io_w);
        var total: usize = 0;
        var s: usize = 0;
        while (s < splat) : (s += 1) {
            for (data) |slice| {
                self.file.writeAll(slice) catch return error.WriteFailed;
                total += slice.len;
                self.bytes_written += slice.len;

                const now_ms = std.time.milliTimestamp();
                if (now_ms - self.last_emit_ms >= 100) {
                    self.last_emit_ms = now_ms;
                    var pr = Response{};
                    pr.id = self.req_id;
                    pr.response_type = .progress;
                    const written = std.fmt.bufPrint(&pr.body, "{{\"d\":{d},\"t\":0}}", .{self.bytes_written}) catch return error.WriteFailed;
                    pr.body_len = written.len;
                    _ = response_queue.push(pr); // drop on full — progress is best-effort
                }
            }
        }
        return total;
    }

};

// ── Streaming + Download execution ───────────────────────────────────────

fn executeStreamOrDownload(client: *std.http.Client, req: *const Request) void {
    const url = req.url[0..req.url_len];
    const method = methodFromReq(req);
    var extra_headers = buildExtraHeaders(req);
    const payload = if (req.body_len > 0) req.body[0..req.body_len] else null;

    if (req.stream) {
        var stream_writer = StreamWriter.init(req.id);
        const result = client.fetch(.{
            .location = .{ .url = url },
            .method = method,
            .payload = payload,
            .extra_headers = extra_headers[0..req.header_count],
            .response_writer = &stream_writer.interface,
            .keep_alive = false,
            .redirect_behavior = .init(10),
        });

        var done = Response{};
        done.id = req.id;
        if (result) |r| {
            done.response_type = .complete;
            done.status = @intFromEnum(r.status);
        } else |err| {
            done.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(done.error_msg[0..elen], msg[0..elen]);
            done.error_len = elen;
        }
        while (!response_queue.push(done)) {
            std.Thread.sleep(1_000_000);
        }
    } else {
        // Download mode
        const file = std.fs.cwd().createFile(req.download_path[0..req.download_path_len], .{}) catch |err| {
            var done = Response{};
            done.id = req.id;
            done.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(done.error_msg[0..elen], msg[0..elen]);
            done.error_len = elen;
            while (!response_queue.push(done)) {
                std.Thread.sleep(1_000_000);
            }
            return;
        };
        defer file.close();

        var dl_writer = DownloadWriter.init(req.id, file);
        const result = client.fetch(.{
            .location = .{ .url = url },
            .method = method,
            .payload = payload,
            .extra_headers = extra_headers[0..req.header_count],
            .response_writer = &dl_writer.interface,
            .keep_alive = false,
            .redirect_behavior = .init(10),
        });

        var done = Response{};
        done.id = req.id;
        if (result) |r| {
            done.response_type = .complete;
            done.status = @intFromEnum(r.status);
        } else |err| {
            done.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(done.error_msg[0..elen], msg[0..elen]);
            done.error_len = elen;
        }
        while (!response_queue.push(done)) {
            std.Thread.sleep(1_000_000);
        }
    }
}
