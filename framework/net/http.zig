//! HTTP/HTTPS client — std.http.Client worker pool with bounded Io queues.
//!
//! Replaces the previous libcurl implementation. Worker tasks block on the
//! HTTP request through the injected I/O implementation, while the main task
//! polls responses each frame.
//!
//! Usage from generated code:
//!   const http = @import("net/http.zig");
//!   try http.init(io, environ_map);
//!   http.request(io, 1, .{ .url = "https://example.com" });
//!   // each frame:
//!   var responses: [16]http.Response = undefined;
//!   const n = http.poll(io, &responses);
//!   for (responses[0..n]) |resp| { ... }
//!   // on shutdown:
//!   http.destroy(io);

const std = @import("std");

// ── Configuration ────────────────────────────────────────────────────────

const MAX_WORKERS = 4;
const MAX_URL = 2048;
const MAX_HEADERS = 16;
const MAX_HEADER_LEN = 512;
const MAX_CONTENT_TYPE = 128;
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
    final_url: [MAX_URL]u8 = undefined,
    final_url_len: usize = 0,
    content_type: [MAX_CONTENT_TYPE]u8 = undefined,
    content_type_len: usize = 0,

    pub fn bodySlice(self: *const Response) []const u8 {
        return self.body[0..self.body_len];
    }

    pub fn errorSlice(self: *const Response) []const u8 {
        return self.error_msg[0..self.error_len];
    }

    pub fn finalUrlSlice(self: *const Response) []const u8 {
        return self.final_url[0..self.final_url_len];
    }

    pub fn contentTypeSlice(self: *const Response) []const u8 {
        return self.content_type[0..self.content_type_len];
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
};

// ── Module state ─────────────────────────────────────────────────────────

var request_storage: [QUEUE_SIZE]Request = undefined;
var response_storage: [QUEUE_SIZE]Response = undefined;
var request_queue: std.Io.Queue(Request) = .init(&request_storage);
var response_queue: std.Io.Queue(Response) = .init(&response_storage);
var worker_tasks: std.Io.Group = .init;
var initialized = false;

const WorkerContext = struct {
    io: std.Io,
    environ: *const std.process.Environ.Map,
};

// ── Public API ───────────────────────────────────────────────────────────

/// Initialize the HTTP client. Starts cancelable workers on the injected I/O
/// implementation; no process-global executor or raw thread handles are used.
pub fn init(io: std.Io, environ: *const std.process.Environ.Map) !void {
    if (initialized) return;
    request_queue = .init(&request_storage);
    response_queue = .init(&response_storage);
    worker_tasks = .init;
    errdefer worker_tasks.cancel(io);
    for (0..MAX_WORKERS) |_| {
        try worker_tasks.concurrent(io, workerMain, .{WorkerContext{ .io = io, .environ = environ }});
    }
    initialized = true;
}

/// Queue an HTTP request. Non-blocking. Returns false if queue is full.
pub fn request(io: std.Io, id: u32, opts: RequestOpts) bool {
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

    return (request_queue.putUncancelable(io, &.{req}, 0) catch 0) == 1;
}

/// Perform a synchronous HTTP request on the calling thread.
/// Returns a fully populated Response including final_url and content_type.
pub fn fetchSync(io: std.Io, environ: *const std.process.Environ.Map, opts: RequestOpts) Response {
    const alloc = std.heap.page_allocator;
    var client: std.http.Client = .{ .allocator = alloc, .io = io };
    defer client.deinit();
    var proxy_arena = std.heap.ArenaAllocator.init(alloc);
    defer proxy_arena.deinit();
    client.initDefaultProxies(proxy_arena.allocator(), environ) catch {};

    var req = Request{};
    req.id = 0;
    const url_len = @min(opts.url.len, MAX_URL);
    @memcpy(req.url[0..url_len], opts.url[0..url_len]);
    req.url_len = url_len;
    req.method = opts.method;
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
    if (opts.body) |body| {
        const blen = @min(body.len, MAX_REQ_BODY);
        @memcpy(req.body[0..blen], body[0..blen]);
        req.body_len = blen;
    }

    var resp = Response{};
    executeRequestOnClient(&client, &req, &resp) catch |err| {
        resp.response_type = .err;
        const msg = @errorName(err);
        const elen = @min(msg.len, MAX_ERROR);
        @memcpy(resp.error_msg[0..elen], msg[0..elen]);
        resp.error_len = elen;
    };
    return resp;
}

/// Poll for completed responses. Non-blocking — returns count.
pub fn poll(io: std.Io, out: []Response) usize {
    return response_queue.getUncancelable(io, out, 0) catch 0;
}

/// Shutdown all workers and cleanup.
pub fn destroy(io: std.Io) void {
    if (!initialized) return;
    worker_tasks.cancel(io);
    initialized = false;
}

// ── Worker thread ────────────────────────────────────────────────────────

fn workerMain(context: WorkerContext) std.Io.Cancelable!void {
    const alloc = std.heap.page_allocator;
    const io = context.io;
    var client: std.http.Client = .{ .allocator = alloc, .io = io };
    defer client.deinit();
    var proxy_arena = std.heap.ArenaAllocator.init(alloc);
    defer proxy_arena.deinit();
    client.initDefaultProxies(proxy_arena.allocator(), context.environ) catch {};

    while (true) {
        const req = request_queue.getOne(io) catch |err| switch (err) {
            error.Canceled => return error.Canceled,
            error.Closed => return,
        };

        if (req.stream or req.download_path_len > 0) {
            try executeStreamOrDownload(io, &client, &req);
            continue;
        }

        // Execute the request
        var resp = Response{};
        resp.id = req.id;
        executeRequestOnClient(&client, &req, &resp) catch |err| {
            if (err == error.Canceled) return error.Canceled;
            resp.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(resp.error_msg[0..elen], msg[0..elen]);
            resp.error_len = elen;
        };
        response_queue.putOne(io, resp) catch |err| switch (err) {
            error.Canceled => return error.Canceled,
            error.Closed => return,
        };
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

fn queueResponse(io: std.Io, response: Response) std.Io.Cancelable!void {
    response_queue.putOne(io, response) catch |err| switch (err) {
        error.Canceled => return error.Canceled,
        error.Closed => return,
    };
}

fn executeRequestOnClient(client: *std.http.Client, req: *const Request, resp: *Response) !void {
    const alloc = std.heap.page_allocator;
    const url = req.url[0..req.url_len];
    const method = methodFromReq(req);
    var extra_headers = buildExtraHeaders(req);
    const payload = if (req.body_len > 0) req.body[0..req.body_len] else null;

    const uri = try std.Uri.parse(url);
    var request_obj = try client.request(method, uri, .{
        .extra_headers = extra_headers[0..req.header_count],
        .headers = .{ .accept_encoding = .omit },
        .keep_alive = false,
        .redirect_behavior = .init(10),
    });
    defer request_obj.deinit();

    if (payload) |p| {
        request_obj.transfer_encoding = .{ .content_length = p.len };
        var body = try request_obj.sendBodyUnflushed(&.{});
        try body.writer.writeAll(p);
        try body.end();
        try request_obj.connection.?.flush();
    } else {
        try request_obj.sendBodiless();
    }

    var redirect_buf: [8192]u8 = undefined;
    var response = try request_obj.receiveHead(&redirect_buf);

    resp.status = @intFromEnum(response.head.status);

    // Capture final URL
    if (std.fmt.bufPrint(&resp.final_url, "{f}", .{request_obj.uri.fmt(.all)})) |s| {
        resp.final_url_len = s.len;
    } else |_| {
        resp.final_url_len = 0;
    }

    // Capture Content-Type from headers
    var hit = std.http.HeaderIterator.init(response.head.bytes);
    while (hit.next()) |hdr| {
        if (std.ascii.eqlIgnoreCase(hdr.name, "content-type")) {
            const ct_len = @min(hdr.value.len, MAX_CONTENT_TYPE);
            if (ct_len > 0) {
                @memcpy(resp.content_type[0..ct_len], hdr.value[0..ct_len]);
            }
            resp.content_type_len = ct_len;
            break;
        }
    }

    // Read body
    var body_list: std.ArrayList(u8) = .empty;
    defer body_list.deinit(alloc);

    var transfer_buf: [4096]u8 = undefined;
    const reader = response.reader(&transfer_buf);
    while (true) {
        var buf: [4096]u8 = undefined;
        const n = reader.readSliceShort(&buf) catch break;
        if (n == 0) break;
        try body_list.appendSlice(alloc, buf[0..n]);
    }

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
//
// Streaming reuses the EXACT request/read mechanism of the non-streaming
// path (executeRequestOnClient): client.request + receiveHead + a manual
// reader.readSliceShort loop, pushing each read as a .chunk and a terminal
// .complete at EOF.
//
// The earlier implementation drove client.fetch(.{ .response_writer = … }).
// That higher-level API blocks indefinitely reading a `Connection: close`
// response from our own httpserver — fetch's internal reader never sees the
// body "end", so the worker never returned and the terminal done event
// never fired. Every streaming client against a useHost server hung as a
// result (the symptom: server reads the request, client waits forever).
//
// readSliceShort breaks cleanly on EOF/error, so this works for BOTH
// incremental SSE (each short read returns a token batch → one chunk per
// read, real streaming preserved) AND atomic responses that arrive and
// close at once (one chunk, then done) — e.g. the claudewrap bridge, whose
// MCP/transcript reply lands all at once with nothing to stream.
fn streamRequestOnClient(io: std.Io, client: *std.http.Client, req: *const Request, status_out: *u16) !void {
    const url = req.url[0..req.url_len];
    const method = methodFromReq(req);
    var extra_headers = buildExtraHeaders(req);
    const payload = if (req.body_len > 0) req.body[0..req.body_len] else null;

    const uri = try std.Uri.parse(url);
    var request_obj = try client.request(method, uri, .{
        .extra_headers = extra_headers[0..req.header_count],
        .headers = .{ .accept_encoding = .omit },
        .keep_alive = false,
        .redirect_behavior = .init(10),
    });
    defer request_obj.deinit();

    if (payload) |p| {
        request_obj.transfer_encoding = .{ .content_length = p.len };
        var body = try request_obj.sendBodyUnflushed(&.{});
        try body.writer.writeAll(p);
        try body.end();
        try request_obj.connection.?.flush();
    } else {
        try request_obj.sendBodiless();
    }

    var redirect_buf: [8192]u8 = undefined;
    var response = try request_obj.receiveHead(&redirect_buf);
    status_out.* = @intFromEnum(response.head.status);

    var transfer_buf: [4096]u8 = undefined;
    const reader = response.reader(&transfer_buf);
    while (true) {
        var buf: [4096]u8 = undefined;
        const n = reader.readSliceShort(&buf) catch break;
        if (n == 0) break;
        var off: usize = 0;
        while (off < n) {
            var chunk = Response{};
            chunk.id = req.id;
            chunk.response_type = .chunk;
            const to_copy = @min(n - off, MAX_BODY);
            @memcpy(chunk.body[0..to_copy], buf[off .. off + to_copy]);
            chunk.body_len = to_copy;
            try queueResponse(io, chunk);
            off += to_copy;
        }
    }
}

// ── Download ─────────────────────────────────────────────────────────────

const DownloadWriter = struct {
    io: std.Io,
    req_id: u32,
    file: std.Io.File,
    bytes_written: usize = 0,
    last_emit_ms: i64 = 0,
    interface: std.Io.Writer,

    pub fn init(io: std.Io, req_id: u32, file: std.Io.File) DownloadWriter {
        return .{
            .io = io,
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
                self.file.writeStreamingAll(self.io, slice) catch return error.WriteFailed;
                total += slice.len;
                self.bytes_written += slice.len;

                const now_ms = std.Io.Clock.now(.real, self.io).toMilliseconds();
                if (now_ms - self.last_emit_ms >= 100) {
                    self.last_emit_ms = now_ms;
                    var pr = Response{};
                    pr.id = self.req_id;
                    pr.response_type = .progress;
                    const written = std.fmt.bufPrint(&pr.body, "{{\"d\":{d},\"t\":0}}", .{self.bytes_written}) catch return error.WriteFailed;
                    pr.body_len = written.len;
                    _ = response_queue.putUncancelable(self.io, &.{pr}, 0) catch 0; // best-effort
                }
            }
        }
        return total;
    }
};

// ── Streaming + Download execution ───────────────────────────────────────

fn executeStreamOrDownload(io: std.Io, client: *std.http.Client, req: *const Request) std.Io.Cancelable!void {
    const url = req.url[0..req.url_len];
    const method = methodFromReq(req);
    var extra_headers = buildExtraHeaders(req);
    const payload = if (req.body_len > 0) req.body[0..req.body_len] else null;

    if (req.stream) {
        var status: u16 = 0;
        const result = streamRequestOnClient(io, client, req, &status);

        var done = Response{};
        done.id = req.id;
        if (result) |_| {
            done.response_type = .complete;
            done.status = status;
        } else |err| {
            if (err == error.Canceled) return error.Canceled;
            done.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(done.error_msg[0..elen], msg[0..elen]);
            done.error_len = elen;
        }
        try queueResponse(io, done);
    } else {
        // Download mode
        const file = std.Io.Dir.cwd().createFile(io, req.download_path[0..req.download_path_len], .{}) catch |err| {
            if (err == error.Canceled) return error.Canceled;
            var done = Response{};
            done.id = req.id;
            done.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(done.error_msg[0..elen], msg[0..elen]);
            done.error_len = elen;
            try queueResponse(io, done);
            return;
        };
        defer file.close(io);

        var dl_writer = DownloadWriter.init(io, req.id, file);
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
            if (err == error.Canceled) return error.Canceled;
            done.response_type = .err;
            const msg = @errorName(err);
            const elen = @min(msg.len, MAX_ERROR);
            @memcpy(done.error_msg[0..elen], msg[0..elen]);
            done.error_len = elen;
        }
        try queueResponse(io, done);
    }
}

test "public HTTP API compiles" {
    std.testing.refAllDecls(@This());
}

test "idle HTTP workers cancel without sentinels" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();

    try init(std.testing.io, &environ);
    destroy(std.testing.io);
}
