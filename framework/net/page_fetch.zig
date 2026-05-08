//! Browser page fetch worker pool.
//!
//! Narrow scope on purpose:
//! - GET only
//! - HTTP/1.1 over plain TCP or tls.zig
//! - follows redirects
//! - captures a text/html-ish response body for the browser shell
//!
//! This is separate from the generic runtime http hook (framework/net/http.zig)
//! which now uses std.http.Client.

const std = @import("std");
const tls = @import("tls");
const RingBuffer = @import("ring_buffer.zig").RingBuffer;

const MAX_WORKERS = 4;
const MAX_URL = 2048;
const MAX_CONTENT_TYPE = 128;
const MAX_BODY = 256 * 1024;
const MAX_RAW = MAX_BODY + 16 * 1024;
const MAX_ERROR = 256;
const MAX_REDIRECTS = 5;
const QUEUE_SIZE = 16;

pub const ResponseType = enum { complete, err };

pub const Response = struct {
    id: u32 = 0,
    status: u16 = 0,
    final_url: [MAX_URL]u8 = undefined,
    final_url_len: usize = 0,
    content_type: [MAX_CONTENT_TYPE]u8 = undefined,
    content_type_len: usize = 0,
    body: [MAX_BODY]u8 = undefined,
    body_len: usize = 0,
    truncated: bool = false,
    response_type: ResponseType = .complete,
    error_msg: [MAX_ERROR]u8 = undefined,
    error_len: usize = 0,

    pub fn finalUrlSlice(self: *const Response) []const u8 {
        return self.final_url[0..self.final_url_len];
    }

    pub fn contentTypeSlice(self: *const Response) []const u8 {
        return self.content_type[0..self.content_type_len];
    }

    pub fn bodySlice(self: *const Response) []const u8 {
        return self.body[0..self.body_len];
    }

    pub fn errorSlice(self: *const Response) []const u8 {
        return self.error_msg[0..self.error_len];
    }
};

const Request = struct {
    id: u32 = 0,
    url: [MAX_URL]u8 = undefined,
    url_len: usize = 0,
    shutdown: bool = false,
};

const FetchResult = struct {
    status: u16,
    final_url: []u8,
    content_type: []u8,
    body: []u8,
    location: ?[]u8,
    truncated: bool,

    fn deinit(self: *FetchResult, alloc: std.mem.Allocator) void {
        alloc.free(self.final_url);
        alloc.free(self.content_type);
        alloc.free(self.body);
        if (self.location) |location| alloc.free(location);
    }
};

const RawFetch = struct {
    bytes: []u8,
    truncated: bool,
};

const DecodedBody = struct {
    bytes: []u8,
    truncated: bool,
};

var request_queue: RingBuffer(Request, QUEUE_SIZE) = .{};
var response_queue: RingBuffer(Response, QUEUE_SIZE) = .{};
var workers: [MAX_WORKERS]?std.Thread = .{ null, null, null, null };
var initialized = false;

pub fn init() void {
    if (initialized) return;
    for (0..MAX_WORKERS) |i| {
        workers[i] = std.Thread.spawn(.{}, workerMain, .{}) catch null;
    }
    initialized = true;
}

pub fn request(id: u32, url: []const u8) bool {
    var req = Request{ .id = id };
    const len = @min(url.len, MAX_URL);
    @memcpy(req.url[0..len], url[0..len]);
    req.url_len = len;
    return request_queue.push(req);
}

pub fn fetchSync(url: []const u8) Response {
    var resp = Response{};
    executeRequest(url, &resp);
    return resp;
}

pub fn poll(out: []Response) usize {
    return response_queue.drain(out);
}

pub fn destroy() void {
    if (!initialized) return;
    var sent: usize = 0;
    while (sent < MAX_WORKERS) {
        var sentinel = Request{};
        sentinel.shutdown = true;
        if (request_queue.push(sentinel)) {
            sent += 1;
        } else {
            std.Thread.sleep(1_000_000);
        }
    }
    for (0..MAX_WORKERS) |i| {
        if (workers[i]) |thread| thread.join();
        workers[i] = null;
    }
    initialized = false;
}

fn workerMain() void {
    while (true) {
        const req = blk: {
            while (true) {
                if (request_queue.pop()) |item| break :blk item;
                std.Thread.sleep(1_000_000);
            }
        };
        if (req.shutdown) return;

        var resp = Response{ .id = req.id };
        executeRequest(req.url[0..req.url_len], &resp);
        while (!response_queue.push(resp)) {
            std.Thread.sleep(1_000_000);
        }
    }
}

fn executeRequest(url: []const u8, resp: *Response) void {
    const alloc = std.heap.page_allocator;

    var current_buf: [MAX_URL]u8 = undefined;
    const initial_len = copyString(current_buf[0..], url);
    var current: []const u8 = current_buf[0..initial_len];

    var attempt: usize = 0;
    while (true) : (attempt += 1) {
        var result = fetchOnce(alloc, current) catch |err| {
            setError(resp, @errorName(err));
            return;
        };
        defer result.deinit(alloc);

        if (isRedirectStatus(result.status) and result.location != null and attempt < MAX_REDIRECTS) {
            const next = resolveRedirect(result.final_url, result.location.?, current_buf[0..]) catch |err| {
                setError(resp, @errorName(err));
                return;
            };
            current = next;
            continue;
        }

        resp.status = result.status;
        resp.final_url_len = copyString(resp.final_url[0..], result.final_url);
        resp.content_type_len = copyString(resp.content_type[0..], result.content_type);
        resp.body_len = copyBody(resp.body[0..], result.body);
        resp.truncated = result.truncated or result.body.len > MAX_BODY;
        resp.response_type = .complete;
        return;
    }
}

fn fetchOnce(alloc: std.mem.Allocator, url: []const u8) !FetchResult {
    const uri = try std.Uri.parse(url);
    var host_buf: [std.Uri.host_name_max]u8 = undefined;
    const host = try uri.getHost(host_buf[0..]);

    const scheme = uri.scheme;
    const port: u16 = uri.port orelse if (std.ascii.eqlIgnoreCase(scheme, "https")) 443 else if (std.ascii.eqlIgnoreCase(scheme, "http")) 80 else return error.UnsupportedScheme;

    var target_buf: [MAX_URL + 32]u8 = undefined;
    const target = try buildRequestTarget(uri, &target_buf);

    var host_header_buf: [std.Uri.host_name_max + 32]u8 = undefined;
    const host_header = try buildHostHeader(uri, &host_header_buf);

    var req_buf: [MAX_URL * 2 + 512]u8 = undefined;
    const request_bytes = try std.fmt.bufPrint(
        &req_buf,
        "GET {s} HTTP/1.1\r\nHost: {s}\r\nUser-Agent: ReactJIT Browser/0.1\r\nAccept: text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n",
        .{ target, host_header },
    );

    const raw = if (std.ascii.eqlIgnoreCase(scheme, "https"))
        try fetchHttps(alloc, host, port, request_bytes)
    else if (std.ascii.eqlIgnoreCase(scheme, "http"))
        try fetchHttp(alloc, host, port, request_bytes)
    else
        return error.UnsupportedScheme;
    defer alloc.free(raw.bytes);

    return try parseHttpResponse(alloc, raw.bytes, raw.truncated, url);
}

fn fetchHttp(alloc: std.mem.Allocator, host: []const u8, port: u16, request_bytes: []const u8) !RawFetch {
    const stream = try std.net.tcpConnectToHost(alloc, host, port);
    defer stream.close();
    try stream.writeAll(request_bytes);
    return try readAllBytes(alloc, stream, MAX_RAW);
}

fn fetchHttps(alloc: std.mem.Allocator, host: []const u8, port: u16, request_bytes: []const u8) !RawFetch {
    const stream = try std.net.tcpConnectToHost(alloc, host, port);
    defer stream.close();

    var input_buf: [tls.input_buffer_len]u8 = undefined;
    var output_buf: [tls.output_buffer_len]u8 = undefined;
    var tcp_reader = stream.reader(&input_buf);
    var tcp_writer = stream.writer(&output_buf);
    const input = tcp_reader.interface();
    const output = &tcp_writer.interface;

    var root_ca: tls.config.cert.Bundle = .{};
    try root_ca.rescan(alloc);
    defer root_ca.deinit(alloc);

    var conn = try tls.client(input, output, .{
        .host = host,
        .root_ca = root_ca,
        .now = tls.Timestamp.now(),
        .named_groups = &.{ .x25519, .secp256r1, .secp384r1 },
    });
    defer conn.close() catch {};

    try conn.writeAll(request_bytes);
    return try readAllBytes(alloc, &conn, MAX_RAW);
}

fn readAllBytes(alloc: std.mem.Allocator, stream_like: anytype, max_bytes: usize) !RawFetch {
    var out = std.ArrayList(u8){};
    errdefer out.deinit(alloc);

    var buf: [8192]u8 = undefined;
    var truncated = false;
    while (true) {
        const n = try stream_like.read(&buf);
        if (n == 0) break;
        const room = max_bytes -| out.items.len;
        const take = @min(room, n);
        if (take > 0) try out.appendSlice(alloc, buf[0..take]);
        if (take < n or out.items.len >= max_bytes) {
            truncated = true;
            break;
        }
    }

    return .{
        .bytes = try out.toOwnedSlice(alloc),
        .truncated = truncated,
    };
}

fn parseHttpResponse(alloc: std.mem.Allocator, raw: []const u8, raw_truncated: bool, source_url: []const u8) !FetchResult {
    const header_marker = std.mem.indexOf(u8, raw, "\r\n\r\n") orelse return error.InvalidResponse;
    const header_bytes = raw[0..header_marker];
    const body_bytes = raw[header_marker + 4 ..];

    var lines = std.mem.splitSequence(u8, header_bytes, "\r\n");
    const status_line = lines.next() orelse return error.InvalidResponse;
    var status_parts = std.mem.splitScalar(u8, status_line, ' ');
    _ = status_parts.next();
    const status_txt = status_parts.next() orelse return error.InvalidResponse;
    const status = std.fmt.parseInt(u16, status_txt, 10) catch return error.InvalidResponse;

    var content_type: []const u8 = "";
    var location: ?[]const u8 = null;
    var chunked = false;

    while (lines.next()) |line| {
        if (line.len == 0) continue;
        const colon = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const name = std.mem.trim(u8, line[0..colon], " \t");
        const value = std.mem.trim(u8, line[colon + 1 ..], " \t");
        if (std.ascii.eqlIgnoreCase(name, "content-type")) {
            content_type = value;
        } else if (std.ascii.eqlIgnoreCase(name, "location")) {
            location = value;
        } else if (std.ascii.eqlIgnoreCase(name, "transfer-encoding")) {
            chunked = std.ascii.indexOfIgnoreCase(value, "chunked") != null;
        }
    }

    const body: DecodedBody = if (chunked)
        try decodeChunkedBody(alloc, body_bytes, MAX_BODY)
    else
        .{
            .bytes = try alloc.dupe(u8, body_bytes[0..@min(body_bytes.len, MAX_BODY)]),
            .truncated = raw_truncated or body_bytes.len > MAX_BODY,
        };
    errdefer alloc.free(body.bytes);

    return .{
        .status = status,
        .final_url = try alloc.dupe(u8, source_url),
        .content_type = try alloc.dupe(u8, content_type),
        .location = if (location) |loc| try alloc.dupe(u8, loc) else null,
        .body = body.bytes,
        .truncated = body.truncated,
    };
}

fn decodeChunkedBody(alloc: std.mem.Allocator, src: []const u8, limit: usize) !DecodedBody {
    var out = std.ArrayList(u8){};
    errdefer out.deinit(alloc);

    var index: usize = 0;
    var truncated = false;
    while (index < src.len) {
        const line_end_rel = std.mem.indexOfPos(u8, src, index, "\r\n") orelse return error.InvalidChunkedEncoding;
        const line = src[index..line_end_rel];
        index = line_end_rel + 2;
        if (line.len == 0) continue;

        const semi = std.mem.indexOfScalar(u8, line, ';') orelse line.len;
        const size_txt = std.mem.trim(u8, line[0..semi], " \t");
        const chunk_len = std.fmt.parseInt(usize, size_txt, 16) catch return error.InvalidChunkedEncoding;
        if (chunk_len == 0) break;
        if (index + chunk_len > src.len) return error.InvalidChunkedEncoding;

        const room = limit -| out.items.len;
        const take = @min(room, chunk_len);
        if (take > 0) try out.appendSlice(alloc, src[index .. index + take]);
        if (take < chunk_len) {
            truncated = true;
            break;
        }

        index += chunk_len;
        if (index + 2 > src.len or !std.mem.eql(u8, src[index .. index + 2], "\r\n")) {
            return error.InvalidChunkedEncoding;
        }
        index += 2;
    }

    return .{
        .bytes = try out.toOwnedSlice(alloc),
        .truncated = truncated,
    };
}

fn buildRequestTarget(uri: std.Uri, buf: []u8) ![]const u8 {
    return std.fmt.bufPrint(buf, "{f}", .{uri.fmt(.{
        .path = true,
        .query = true,
    })});
}

fn buildHostHeader(uri: std.Uri, buf: []u8) ![]const u8 {
    const default_port: u16 = if (std.ascii.eqlIgnoreCase(uri.scheme, "https")) 443 else if (std.ascii.eqlIgnoreCase(uri.scheme, "http")) 80 else 0;
    return std.fmt.bufPrint(buf, "{f}", .{uri.fmt(.{
        .authority = true,
        .path = false,
        .port = uri.port != null and uri.port.? != default_port,
    })});
}

fn resolveRedirect(base_url: []const u8, location: []const u8, buf: []u8) ![]const u8 {
    if (location.len > buf.len) return error.NoSpaceLeft;
    @memcpy(buf[0..location.len], location);
    var aux = buf;
    const base = try std.Uri.parse(base_url);
    const resolved = try base.resolveInPlace(location.len, &aux);
    return std.fmt.bufPrint(buf, "{f}", .{resolved.fmt(.all)});
}

fn copyString(dest: []u8, src: []const u8) usize {
    const n = @min(dest.len, src.len);
    @memcpy(dest[0..n], src[0..n]);
    return n;
}

fn copyBody(dest: []u8, src: []const u8) usize {
    return copyString(dest, src);
}

fn setError(resp: *Response, message: []const u8) void {
    resp.response_type = .err;
    resp.error_len = copyString(resp.error_msg[0..], message);
}

fn isRedirectStatus(status: u16) bool {
    return switch (status) {
        301, 302, 303, 307, 308 => true,
        else => false,
    };
}
