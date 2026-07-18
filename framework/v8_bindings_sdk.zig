const std = @import("std");
const HostContext = @import("host_context.zig");
const v8 = @import("v8");
const v8rt = @import("v8_runtime.zig");

const net_http = @import("net/http.zig");
const browse_bridge = @import("net/browse_bridge.zig");
const debug_client = @import("diag/debug_client.zig");
const build_options = @import("build_options");
const HAS_TERMINAL = if (@hasDecl(build_options, "has_terminal")) build_options.has_terminal else false;
const player_mod = @import("terminal/player.zig");
const vterm_mod = @import("terminal/vterm.zig");
const semantic = @import("terminal/semantic.zig");
const classifier = @import("terminal/classifier.zig");
const worker_bindings = @import("assistant/worker_bindings.zig");

const HTTP_MAX_HEADERS: usize = 16;

var g_http_init_done: bool = false;

/// Zig-side stream consumer for net_http. Lets in-process callers (e.g.
/// openai_compat_sdk) hook the same poll/dispatch loop the JS-facing
/// __http_stream_open path uses, without re-implementing HTTP client setup.
pub const HttpZigCallbacks = struct {
    onChunk: *const fn (ctx: *anyopaque, data: []const u8) void,
    onEnd: *const fn (ctx: *anyopaque, status: u16, err: ?[]const u8) void,
    ctx: *anyopaque,
};

const HttpPending = struct {
    rid: []u8,
    stream: bool,
    download: bool = false,
    zig: ?HttpZigCallbacks = null,
};
var g_http_pending: ?std.AutoHashMap(u32, HttpPending) = null;
var g_http_zig_next_id: u32 = 0xF000_0000;
var g_page_pending: ?std.AutoHashMap(u32, []u8) = null;

var g_browse_init_done: bool = false;
var g_browse_pending: ?std.AutoHashMap(u32, []u8) = null;

fn ensureHttp(host: *HostContext) bool {
    if (g_http_init_done) return true;
    net_http.init(host.io, host.environ) catch return false;
    g_http_init_done = true;
    return true;
}

fn ensureBrowse(io: std.Io) bool {
    if (g_browse_init_done) return true;
    browse_bridge.init(io) catch return false;
    g_browse_init_done = true;
    return true;
}

fn callbackCtx(info: v8.FunctionCallbackInfo) struct { iso: v8.Isolate, ctx: v8.Context } {
    const iso = info.getIsolate();
    return .{ .iso = iso, .ctx = iso.getCurrentContext() };
}

fn setReturnUndefined(info: v8.FunctionCallbackInfo, iso: v8.Isolate) void {
    info.getReturnValue().set(v8.initUndefined(iso));
}

fn setReturnBool(info: v8.FunctionCallbackInfo, iso: v8.Isolate, val: bool) void {
    info.getReturnValue().set(v8.Boolean.init(iso, val));
}

fn setReturnNum(info: v8.FunctionCallbackInfo, iso: v8.Isolate, val: f64) void {
    info.getReturnValue().set(v8.Number.init(iso, val));
}

fn setReturnInt(info: v8.FunctionCallbackInfo, iso: v8.Isolate, val: i64) void {
    info.getReturnValue().set(v8.Number.init(iso, @floatFromInt(val)));
}

fn setReturnString(info: v8.FunctionCallbackInfo, iso: v8.Isolate, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn jsStringArg(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const cx = callbackCtx(info);
    const s = info.getArg(idx).toString(cx.ctx) catch return null;
    const len = s.lenUtf8(cx.iso);
    const buf = alloc.alloc(u8, len) catch return null;
    _ = s.writeUtf8(cx.iso, buf);
    return buf;
}

fn jsI32Arg(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    const cx = callbackCtx(info);
    return info.getArg(idx).toI32(cx.ctx) catch null;
}

fn jsF64Arg(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const cx = callbackCtx(info);
    return info.getArg(idx).toF64(cx.ctx) catch null;
}

fn setStrProp(iso: v8.Isolate, ctx: v8.Context, obj: v8.Object, key: []const u8, val: []const u8) void {
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, key), v8.String.initUtf8(iso, val));
}

fn setBoolProp(iso: v8.Isolate, ctx: v8.Context, obj: v8.Object, key: []const u8, val: bool) void {
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, key), v8.Boolean.init(iso, val));
}

fn setNumProp(iso: v8.Isolate, ctx: v8.Context, obj: v8.Object, key: []const u8, val: f64) void {
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, key), v8.Number.init(iso, val));
}

fn setIntProp(iso: v8.Isolate, ctx: v8.Context, obj: v8.Object, key: []const u8, val: i64) void {
    setNumProp(iso, ctx, obj, key, @floatFromInt(val));
}

fn jsonEscape(out: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |ch| switch (ch) {
        '"' => try out.appendSlice(alloc, "\\\""),
        '\\' => try out.appendSlice(alloc, "\\\\"),
        '\n' => try out.appendSlice(alloc, "\\n"),
        '\r' => try out.appendSlice(alloc, "\\r"),
        '\t' => try out.appendSlice(alloc, "\\t"),
        0...8, 11, 12, 14...31 => try listPrint(alloc, out, "\\u{x:0>4}", .{ch}),
        else => try out.append(alloc, ch),
    };
    try out.append(alloc, '"');
}

fn listPrint(alloc: std.mem.Allocator, out: *std.ArrayList(u8), comptime format: []const u8, args: anytype) !void {
    var writer: std.Io.Writer.Allocating = .fromArrayList(alloc, out);
    defer out.* = writer.toArrayList();
    try writer.writer.print(format, args);
}

const HttpReq = struct {
    method: []const u8,
    url: []const u8,
    headers: ?std.json.ObjectMap,
    body: ?[]const u8,
    timeout_sec: u32,
};

fn parseHttpReq(parsed: *const std.json.Parsed(std.json.Value)) ?HttpReq {
    const root = parsed.value;
    if (root != .object) return null;
    const url_v = root.object.get("url") orelse return null;
    if (url_v != .string) return null;
    const method: []const u8 = if (root.object.get("method")) |mv|
        (if (mv == .string) mv.string else "GET")
    else
        "GET";
    const headers = if (root.object.get("headers")) |hv|
        (if (hv == .object) hv.object else null)
    else
        null;
    const body: ?[]const u8 = if (root.object.get("body")) |bv|
        (if (bv == .string) bv.string else null)
    else
        null;
    const timeout_ms: u32 = if (root.object.get("timeoutMs")) |tv|
        switch (tv) {
            .integer => |i| @intCast(@max(0, i)),
            .float => |f| @trunc(@max(0.0, f)),
            else => 30_000,
        }
    else
        30_000;
    return .{
        .method = method,
        .url = url_v.string,
        .headers = headers,
        .body = body,
        .timeout_sec = @max(1, timeout_ms / 1000),
    };
}

fn httpSyncViaClient(host: *HostContext, req: HttpReq) ![]u8 {
    const alloc = std.heap.page_allocator;

    const uri = try std.Uri.parse(req.url);
    const method: std.http.Method = if (std.ascii.eqlIgnoreCase(req.method, "POST")) .POST else if (std.ascii.eqlIgnoreCase(req.method, "PUT")) .PUT else if (std.ascii.eqlIgnoreCase(req.method, "DELETE")) .DELETE else if (std.ascii.eqlIgnoreCase(req.method, "PATCH")) .PATCH else if (std.ascii.eqlIgnoreCase(req.method, "HEAD")) .HEAD else .GET;

    var client: std.http.Client = .{ .allocator = alloc, .io = host.io };
    defer client.deinit();
    var proxy_arena = std.heap.ArenaAllocator.init(alloc);
    defer proxy_arena.deinit();
    client.initDefaultProxies(proxy_arena.allocator(), host.environ) catch {};

    var extra_headers: std.ArrayList(std.http.Header) = .empty;
    defer extra_headers.deinit(alloc);
    if (req.headers) |hdrs| {
        var it = hdrs.iterator();
        while (it.next()) |entry| {
            if (entry.value_ptr.* != .string) continue;
            try extra_headers.append(alloc, .{
                .name = entry.key_ptr.*,
                .value = entry.value_ptr.string,
            });
        }
    }

    var request_obj = try client.request(method, uri, .{
        .extra_headers = extra_headers.items,
        .keep_alive = false,
        .redirect_behavior = .init(10),
    });
    defer request_obj.deinit();

    if (req.body) |b| {
        request_obj.transfer_encoding = .{ .content_length = b.len };
        var body = try request_obj.sendBodyUnflushed(&.{});
        try body.writer.writeAll(b);
        try body.end();
        try request_obj.connection.?.flush();
    } else {
        try request_obj.sendBodiless();
    }

    var redirect_buf: [8192]u8 = undefined;
    var response = try request_obj.receiveHead(&redirect_buf);

    const status = @intFromEnum(response.head.status);

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

    // Build JSON with status, headers, body
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    try listPrint(alloc, &out, "{{\"status\":{d},\"headers\":{{", .{status});
    var first_hdr = true;
    var hit = std.http.HeaderIterator.init(response.head.bytes);
    while (hit.next()) |hdr| {
        if (!first_hdr) try out.append(alloc, ',');
        first_hdr = false;
        try jsonEscape(&out, alloc, hdr.name);
        try out.append(alloc, ':');
        try jsonEscape(&out, alloc, hdr.value);
    }
    try out.appendSlice(alloc, "},\"body\":");
    try jsonEscape(&out, alloc, body_list.items);
    try out.append(alloc, '}');
    return out.toOwnedSlice(alloc);
}

fn httpPending() *std.AutoHashMap(u32, HttpPending) {
    if (g_http_pending == null) g_http_pending = std.AutoHashMap(u32, HttpPending).init(std.heap.page_allocator);
    return &g_http_pending.?;
}

fn pagePending() *std.AutoHashMap(u32, []u8) {
    if (g_page_pending == null) g_page_pending = std.AutoHashMap(u32, []u8).init(std.heap.page_allocator);
    return &g_page_pending.?;
}

fn browsePending() *std.AutoHashMap(u32, []u8) {
    if (g_browse_pending == null) g_browse_pending = std.AutoHashMap(u32, []u8).init(std.heap.page_allocator);
    return &g_browse_pending.?;
}

fn hashReqId(s: []const u8) u32 {
    var h = std.hash.Wyhash.init(0xE1_FE_1D);
    h.update(s);
    return @truncate(h.final());
}

fn parsePageReq(parsed: *const std.json.Parsed(std.json.Value)) ?[]const u8 {
    const root = parsed.value;
    if (root != .object) return null;
    const url_v = root.object.get("url") orelse return null;
    return if (url_v == .string) url_v.string else null;
}

fn buildPageRespJson(resp: *const net_http.Response, alloc: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    try listPrint(alloc, &out, "{{\"status\":{d},\"finalUrl\":", .{resp.status});
    try jsonEscape(&out, alloc, resp.finalUrlSlice());
    try out.appendSlice(alloc, ",\"contentType\":");
    try jsonEscape(&out, alloc, resp.contentTypeSlice());
    try out.appendSlice(alloc, ",\"body\":");
    try jsonEscape(&out, alloc, resp.bodySlice());
    try listPrint(alloc, &out, ",\"truncated\":{s}", .{if (resp.truncated) "true" else "false"});
    if (resp.response_type == .err) {
        try out.appendSlice(alloc, ",\"error\":");
        try jsonEscape(&out, alloc, resp.errorSlice());
    }
    try out.append(alloc, '}');
    return out.toOwnedSlice(alloc);
}

fn buildHttpRespJson(resp: *const net_http.Response, alloc: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    try listPrint(alloc, &out, "{{\"status\":{d},\"headers\":{{}},\"body\":", .{resp.status});
    try jsonEscape(&out, alloc, resp.bodySlice());
    if (resp.response_type == .err) {
        try out.appendSlice(alloc, ",\"error\":");
        try jsonEscape(&out, alloc, resp.errorSlice());
    }
    try out.append(alloc, '}');
    return out.toOwnedSlice(alloc);
}

fn hostFetch(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const url = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(url);

    const alloc = std.heap.page_allocator;
    var client: std.http.Client = .{ .allocator = alloc, .io = host.io };
    defer client.deinit();
    var proxy_arena = std.heap.ArenaAllocator.init(alloc);
    defer proxy_arena.deinit();
    client.initDefaultProxies(proxy_arena.allocator(), host.environ) catch {};

    var body_alloc = std.Io.Writer.Allocating.init(alloc);
    defer body_alloc.deinit();

    const result = client.fetch(.{
        .location = .{ .url = url },
        .response_writer = &body_alloc.writer,
        .keep_alive = false,
        .redirect_behavior = .init(10),
    }) catch return setReturnUndefined(info, cx.iso);

    // Treat non-2xx as failure — body may still be written for 4xx/5xx
    // responses (error pages), but the contract for this fast-path
    // host fn is "give me the body of a successful GET or undefined."
    const status: u16 = @intFromEnum(result.status);
    if (status < 200 or status >= 300) return setReturnUndefined(info, cx.iso);

    var body_list = body_alloc.toArrayList();
    defer body_list.deinit(alloc);
    if (body_list.items.len == 0) return setReturnUndefined(info, cx.iso);
    setReturnString(info, cx.iso, body_list.items);
}

fn hostHttpRequestSync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    const json = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnString(info, cx.iso, "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":\"bad request json\"}");
    defer std.heap.page_allocator.free(json);

    const parsed = std.json.parseFromSlice(std.json.Value, std.heap.page_allocator, json, .{}) catch {
        return setReturnString(info, cx.iso, "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":\"bad request json\"}");
    };
    defer parsed.deinit();
    const req = parseHttpReq(&parsed) orelse return setReturnString(info, cx.iso, "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":\"bad request\"}");
    const resp_json = httpSyncViaClient(host, req) catch |err| {
        var buf: [256]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "{{\"status\":0,\"headers\":{{}},\"body\":\"\",\"error\":\"{s}\"}}", .{@errorName(err)}) catch
            return setReturnString(info, cx.iso, "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":\"request failed\"}");
        return setReturnString(info, cx.iso, s);
    };
    defer std.heap.page_allocator.free(resp_json);
    setReturnString(info, cx.iso, resp_json);
}

fn dispatchHttpRequest(info: v8.FunctionCallbackInfo, stream: bool) void {
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    if (info.length() < 2) return setReturnUndefined(info, cx.iso);
    const spec = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(spec);
    const rid = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(rid);

    if (!ensureHttp(host)) return setReturnUndefined(info, cx.iso);

    const parsed = std.json.parseFromSlice(std.json.Value, std.heap.page_allocator, spec, .{}) catch return setReturnUndefined(info, cx.iso);
    defer parsed.deinit();
    const req = parseHttpReq(&parsed) orelse return setReturnUndefined(info, cx.iso);
    const id = hashReqId(rid);
    const rid_copy = std.heap.page_allocator.dupe(u8, rid) catch return setReturnUndefined(info, cx.iso);
    httpPending().put(id, .{ .rid = rid_copy, .stream = stream }) catch {
        std.heap.page_allocator.free(rid_copy);
        return setReturnUndefined(info, cx.iso);
    };

    var hdrs_buf: [HTTP_MAX_HEADERS][2][]const u8 = undefined;
    var opts = net_http.RequestOpts{ .url = req.url, .body = req.body, .stream = stream };
    opts.method = if (std.ascii.eqlIgnoreCase(req.method, "POST")) .POST else if (std.ascii.eqlIgnoreCase(req.method, "PUT")) .PUT else if (std.ascii.eqlIgnoreCase(req.method, "DELETE")) .DELETE else if (std.ascii.eqlIgnoreCase(req.method, "PATCH")) .PATCH else if (std.ascii.eqlIgnoreCase(req.method, "HEAD")) .HEAD else .GET;
    if (req.headers) |hdrs| {
        var it = hdrs.iterator();
        var n: usize = 0;
        while (it.next()) |entry| {
            if (n >= HTTP_MAX_HEADERS) break;
            if (entry.value_ptr.* != .string) continue;
            hdrs_buf[n] = .{ entry.key_ptr.*, entry.value_ptr.string };
            n += 1;
        }
        opts.headers = hdrs_buf[0..n];
    }
    _ = net_http.request(host.io, id, opts);
    setReturnUndefined(info, cx.iso);
}

fn hostHttpRequestAsync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    dispatchHttpRequest(info, false);
}

/// Streaming variant of __http_request_async. Same JSON spec + reqId arg, but
/// chunks emit on `http-stream:<rid>` and a terminal `http-stream-end:<rid>`
/// fires once with `{"status":N}` (success) or `{"error":"..."}` (failure).
fn hostHttpStreamOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    dispatchHttpRequest(info, true);
}

/// Download mode: stream the response body straight to a filesystem path
/// without buffering in memory. Required for any binary larger than
/// MAX_BODY (model files, video, datasets). Three args: JSON request
/// spec, destination path, and a JS-supplied rid for event correlation.
/// Events fire on:
///   __ffiEmit('http-download-progress:<rid>', '{"d":bytesDl,"t":bytesTotal}')
///   __ffiEmit('http-download-end:<rid>',     '{"status":N}' or '{"error":"..."}')
fn hostHttpDownloadToFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    if (info.length() < 3) return setReturnUndefined(info, cx.iso);
    const alloc = std.heap.page_allocator;

    const spec = jsStringArg(alloc, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer alloc.free(spec);
    const dest = jsStringArg(alloc, info, 1) orelse return setReturnUndefined(info, cx.iso);
    defer alloc.free(dest);
    const rid = jsStringArg(alloc, info, 2) orelse return setReturnUndefined(info, cx.iso);
    defer alloc.free(rid);

    if (!ensureHttp(host)) return setReturnUndefined(info, cx.iso);

    const parsed = std.json.parseFromSlice(std.json.Value, alloc, spec, .{}) catch return setReturnUndefined(info, cx.iso);
    defer parsed.deinit();
    const req = parseHttpReq(&parsed) orelse return setReturnUndefined(info, cx.iso);

    const id = hashReqId(rid);
    const rid_copy = alloc.dupe(u8, rid) catch return setReturnUndefined(info, cx.iso);
    httpPending().put(id, .{ .rid = rid_copy, .stream = false, .download = true }) catch {
        alloc.free(rid_copy);
        return setReturnUndefined(info, cx.iso);
    };

    var hdrs_buf: [HTTP_MAX_HEADERS][2][]const u8 = undefined;
    var opts = net_http.RequestOpts{ .url = req.url, .body = req.body, .download_to = dest };
    opts.method = if (std.ascii.eqlIgnoreCase(req.method, "POST")) .POST else if (std.ascii.eqlIgnoreCase(req.method, "PUT")) .PUT else if (std.ascii.eqlIgnoreCase(req.method, "DELETE")) .DELETE else if (std.ascii.eqlIgnoreCase(req.method, "PATCH")) .PATCH else if (std.ascii.eqlIgnoreCase(req.method, "HEAD")) .HEAD else .GET;
    if (req.headers) |hdrs| {
        var it = hdrs.iterator();
        var n: usize = 0;
        while (it.next()) |entry| {
            if (n >= HTTP_MAX_HEADERS) break;
            if (entry.value_ptr.* != .string) continue;
            hdrs_buf[n] = .{ entry.key_ptr.*, entry.value_ptr.string };
            n += 1;
        }
        opts.headers = hdrs_buf[0..n];
    }
    _ = net_http.request(host.io, id, opts);
    setReturnUndefined(info, cx.iso);
}

/// JS-side `close()` symmetry. Cancellation isn't actually plumbed yet
/// (std.http.Client fetch runs to completion in the worker), so this just frees
/// the rid mapping early so any late chunks/end events get dropped on the
/// floor instead of firing into a stale subscriber.
fn hostHttpStreamClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const rid = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(rid);
    const id = hashReqId(rid);
    if (g_http_pending != null) {
        if (httpPending().fetchRemove(id)) |entry| {
            std.heap.page_allocator.free(entry.value.rid);
        }
    }
    setReturnUndefined(info, cx.iso);
}

fn hostBrowserPageSync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    const spec = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnString(info, cx.iso, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"missing request\"}");
    defer std.heap.page_allocator.free(spec);

    const parsed = std.json.parseFromSlice(std.json.Value, std.heap.page_allocator, spec, .{}) catch {
        return setReturnString(info, cx.iso, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"bad request json\"}");
    };
    defer parsed.deinit();
    const url = parsePageReq(&parsed) orelse return setReturnString(info, cx.iso, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"bad request\"}");
    const resp = net_http.fetchSync(host.io, host.environ, .{ .url = url });
    const payload = buildPageRespJson(&resp, std.heap.page_allocator) catch return setReturnString(info, cx.iso, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"serialize failed\"}");
    defer std.heap.page_allocator.free(payload);
    setReturnString(info, cx.iso, payload);
}

fn hostBrowserPageAsync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    if (info.length() < 2) return setReturnUndefined(info, cx.iso);
    const spec = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(spec);
    const rid = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(rid);

    if (!ensureHttp(host)) return setReturnUndefined(info, cx.iso);

    const parsed = std.json.parseFromSlice(std.json.Value, std.heap.page_allocator, spec, .{}) catch return setReturnUndefined(info, cx.iso);
    defer parsed.deinit();
    const url = parsePageReq(&parsed) orelse return setReturnUndefined(info, cx.iso);
    const id = hashReqId(rid);
    const rid_copy = std.heap.page_allocator.dupe(u8, rid) catch return setReturnUndefined(info, cx.iso);
    pagePending().put(id, rid_copy) catch {
        std.heap.page_allocator.free(rid_copy);
        return setReturnUndefined(info, cx.iso);
    };
    _ = net_http.request(host.io, id, .{ .url = url });
    setReturnUndefined(info, cx.iso);
}

fn hostBrowseRequestSync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const io = v8rt.hostContext(cx.iso).io;
    const body = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnString(info, cx.iso, "{\"ok\":false,\"error\":\"missing body\"}");
    defer std.heap.page_allocator.free(body);
    const resp = browse_bridge.requestSync(io, body);
    defer std.heap.page_allocator.free(resp.body);
    setReturnString(info, cx.iso, resp.body);
}

fn hostBrowseRequestAsync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const io = v8rt.hostContext(cx.iso).io;
    if (info.length() < 2) return setReturnUndefined(info, cx.iso);
    const body = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(body);
    const rid = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(rid);

    if (!ensureBrowse(io)) return setReturnUndefined(info, cx.iso);

    const id = hashReqId(rid);
    const rid_copy = std.heap.page_allocator.dupe(u8, rid) catch return setReturnUndefined(info, cx.iso);
    browsePending().put(id, rid_copy) catch {
        std.heap.page_allocator.free(rid_copy);
        return setReturnUndefined(info, cx.iso);
    };
    _ = browse_bridge.request(io, std.heap.page_allocator, id, body);
    setReturnUndefined(info, cx.iso);
}

fn hostBrowseSetPort(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const port_f = jsF64Arg(info, 0) orelse return setReturnUndefined(info, cx.iso);
    if (port_f > 0 and port_f < 65536) {
        browse_bridge.setPort(@trunc(port_f));
    }
    setReturnUndefined(info, cx.iso);
}

fn hostPlayLoad(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const rec = vterm_mod.getRecorder() orelse return setReturnNum(info, cx.iso, 0);
    if (rec.frame_count == 0) return setReturnNum(info, cx.iso, 0);
    player_mod.load(rec);
    setReturnNum(info, cx.iso, 1);
}

fn hostPlayPlay(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    player_mod.play();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostPlayPause(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    player_mod.pause();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostPlayToggle(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    player_mod.togglePlay();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostPlayStep(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    player_mod.step();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostPlaySeek(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (jsF64Arg(info, 0)) |frac| player_mod.seekFraction(@floatCast(frac));
    setReturnUndefined(info, cx.iso);
}

fn hostPlaySpeed(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (jsF64Arg(info, 0)) |spd| player_mod.setSpeed(@floatCast(spd));
    setReturnUndefined(info, cx.iso);
}

fn hostPlayState(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (!player_mod.isLoaded()) return setReturnUndefined(info, cx.iso);
    const s = player_mod.getState();
    const obj = v8.Object.init(cx.iso);
    setBoolProp(cx.iso, cx.ctx, obj, "playing", s.playing);
    setNumProp(cx.iso, cx.ctx, obj, "time_us", @floatFromInt(s.time_us));
    setNumProp(cx.iso, cx.ctx, obj, "duration_us", @floatFromInt(s.duration_us));
    setNumProp(cx.iso, cx.ctx, obj, "frame", s.frame);
    setNumProp(cx.iso, cx.ctx, obj, "total_frames", s.total_frames);
    setNumProp(cx.iso, cx.ctx, obj, "speed", s.speed);
    setBoolProp(cx.iso, cx.ctx, obj, "at_end", s.at_end);
    setBoolProp(cx.iso, cx.ctx, obj, "at_start", s.at_start);
    info.getReturnValue().set(obj.toValue());
}

fn hostRecStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rows = vterm_mod.getRows();
    const cols = vterm_mod.getCols();
    vterm_mod.startRecording(v8rt.hostContext(info.getIsolate()).io, rows, cols);
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostRecStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    vterm_mod.stopRecording();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostRecToggle(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (vterm_mod.isRecording()) {
        vterm_mod.stopRecording();
    } else {
        vterm_mod.startRecording(v8rt.hostContext(info.getIsolate()).io, vterm_mod.getRows(), vterm_mod.getCols());
    }
    setReturnNum(info, callbackCtx(info).iso, if (vterm_mod.isRecording()) 1 else 0);
}

fn hostRecSave(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const path = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnNum(info, cx.iso, 0);
    defer std.heap.page_allocator.free(path);
    const ok = vterm_mod.saveRecording(v8rt.hostContext(info.getIsolate()).io, path);
    setReturnNum(info, cx.iso, if (ok) 1 else 0);
}

fn hostRecIsRecording(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNum(info, callbackCtx(info).iso, if (vterm_mod.isRecording()) 1 else 0);
}

fn hostRecFrameCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rec = vterm_mod.getRecorder() orelse {
        return setReturnNum(info, callbackCtx(info).iso, 0);
    };
    setReturnNum(info, callbackCtx(info).iso, rec.frame_count);
}

fn hostIpcConnect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    if (info.length() < 2) return setReturnNum(info, cx.iso, 0);
    const port_i = jsI32Arg(info, 0) orelse return setReturnNum(info, cx.iso, 0);
    if (port_i <= 0 or port_i > 65535) return setReturnNum(info, cx.iso, 0);
    const key = jsStringArg(host.gpa, info, 1) orelse return setReturnNum(info, cx.iso, 0);
    defer host.gpa.free(key);
    const ok = debug_client.connect(host.gpa, host.io, @intCast(port_i), key);
    setReturnNum(info, cx.iso, if (ok) 1 else 0);
}

fn hostIpcDisconnect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    debug_client.disconnect();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostIpcPoll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    setReturnNum(info, cx.iso, if (debug_client.poll()) 1 else 0);
}

fn hostIpcStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const obj = v8.Object.init(cx.iso);
    setNumProp(cx.iso, cx.ctx, obj, "connected", if (debug_client.isConnected()) 1 else 0);
    setNumProp(cx.iso, cx.ctx, obj, "authenticated", if (debug_client.isAuthenticated()) 1 else 0);
    setNumProp(cx.iso, cx.ctx, obj, "awaiting_code", if (debug_client.isAwaitingCode()) 1 else 0);
    info.getReturnValue().set(obj.toValue());
}

fn hostIpcSubmitCode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    if (info.length() < 1) return setReturnNum(info, cx.iso, 0);
    const code = jsStringArg(host.gpa, info, 0) orelse return setReturnNum(info, cx.iso, 0);
    defer host.gpa.free(code);
    const ok = debug_client.submitCode(code);
    setReturnNum(info, cx.iso, if (ok) 1 else 0);
}

fn hostIpcRequest(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const host = v8rt.hostContext(cx.iso);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const method = jsStringArg(host.gpa, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer host.gpa.free(method);
    debug_client.request(method);
    setReturnUndefined(info, cx.iso);
}

fn hostIpcRequestNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return setReturnUndefined(info, callbackCtx(info).iso);
    const id = jsI32Arg(info, 0) orelse return setReturnUndefined(info, callbackCtx(info).iso);
    debug_client.requestWithId("debug.node", id);
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostIpcTreeCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNum(info, callbackCtx(info).iso, @floatFromInt(debug_client.getTreeNodeCount()));
}

fn hostIpcTreeNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const idx = jsI32Arg(info, 0) orelse return setReturnUndefined(info, cx.iso);
    if (idx < 0) return setReturnUndefined(info, cx.iso);
    const node = debug_client.getTreeNode(@intCast(idx)) orelse return setReturnUndefined(info, cx.iso);
    const obj = v8.Object.init(cx.iso);
    setNumProp(cx.iso, cx.ctx, obj, "index", node.index);
    setNumProp(cx.iso, cx.ctx, obj, "depth", node.depth);
    setStrProp(cx.iso, cx.ctx, obj, "tag", node.tag[0..node.tag_len]);
    info.getReturnValue().set(obj.toValue());
}

fn hostIpcResponse(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const resp = debug_client.getLastResponse() orelse return setReturnUndefined(info, cx.iso);
    setReturnString(info, cx.iso, resp);
}

fn hostIpcPerf(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const p = debug_client.getPerf();
    if (!p.valid) return setReturnUndefined(info, cx.iso);
    const obj = v8.Object.init(cx.iso);
    setNumProp(cx.iso, cx.ctx, obj, "fps", p.fps);
    setNumProp(cx.iso, cx.ctx, obj, "layout_us", p.layout_us);
    setNumProp(cx.iso, cx.ctx, obj, "paint_us", p.paint_us);
    setNumProp(cx.iso, cx.ctx, obj, "gpu_us", p.gpu_us);
    setNumProp(cx.iso, cx.ctx, obj, "frame_total_us", p.frame_total_us);
    setNumProp(cx.iso, cx.ctx, obj, "rects", p.rects);
    setNumProp(cx.iso, cx.ctx, obj, "glyphs", p.glyphs);
    setNumProp(cx.iso, cx.ctx, obj, "total_nodes", p.total_nodes);
    setNumProp(cx.iso, cx.ctx, obj, "visible_nodes", p.visible_nodes);
    setNumProp(cx.iso, cx.ctx, obj, "window_w", p.window_w);
    setNumProp(cx.iso, cx.ctx, obj, "window_h", p.window_h);
    info.getReturnValue().set(obj.toValue());
}

fn hostIpcEnableTelemetry(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    debug_client.enableTelemetryStream();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostSemState(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const s = semantic.getState();
    const obj = v8.Object.init(cx.iso);
    setNumProp(cx.iso, cx.ctx, obj, "mode", @intFromEnum(s.mode));
    setBoolProp(cx.iso, cx.ctx, obj, "streaming", s.streaming);
    setNumProp(cx.iso, cx.ctx, obj, "streaming_kind", @intFromEnum(s.streaming_kind));
    setBoolProp(cx.iso, cx.ctx, obj, "awaiting_input", s.awaiting_input);
    setBoolProp(cx.iso, cx.ctx, obj, "awaiting_decision", s.awaiting_decision);
    setBoolProp(cx.iso, cx.ctx, obj, "modal_open", s.modal_open);
    setBoolProp(cx.iso, cx.ctx, obj, "interrupt_pending", s.interrupt_pending);
    setNumProp(cx.iso, cx.ctx, obj, "turn_count", s.turn_count);
    setNumProp(cx.iso, cx.ctx, obj, "current_turn_id", s.current_turn_id);
    setNumProp(cx.iso, cx.ctx, obj, "node_count", s.node_count);
    setNumProp(cx.iso, cx.ctx, obj, "group_count", s.group_count);
    setStrProp(cx.iso, cx.ctx, obj, "mode_name", @tagName(s.mode));
    setStrProp(cx.iso, cx.ctx, obj, "streaming_kind_name", @tagName(s.streaming_kind));
    info.getReturnValue().set(obj.toValue());
}

fn hostSemNodeCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNum(info, callbackCtx(info).iso, semantic.nodeCount());
}

fn hostSemNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const idx = jsI32Arg(info, 0) orelse return setReturnUndefined(info, cx.iso);
    if (idx < 0) return setReturnUndefined(info, cx.iso);
    const node = semantic.getNode(@intCast(idx)) orelse return setReturnUndefined(info, cx.iso);
    const obj = v8.Object.init(cx.iso);
    setStrProp(cx.iso, cx.ctx, obj, "kind", @tagName(node.kind));
    setStrProp(cx.iso, cx.ctx, obj, "role", @tagName(node.role));
    setStrProp(cx.iso, cx.ctx, obj, "lane", @tagName(node.lane));
    setStrProp(cx.iso, cx.ctx, obj, "scope", @tagName(node.scope));
    setNumProp(cx.iso, cx.ctx, obj, "turn_id", node.turn_id);
    setNumProp(cx.iso, cx.ctx, obj, "group_id", node.group_id);
    setNumProp(cx.iso, cx.ctx, obj, "row_start", node.row_start);
    setNumProp(cx.iso, cx.ctx, obj, "row_end", node.row_end);
    setNumProp(cx.iso, cx.ctx, obj, "row_count", node.row_count);
    setNumProp(cx.iso, cx.ctx, obj, "children_count", node.children_count);
    setBoolProp(cx.iso, cx.ctx, obj, "active", node.active);
    if (node.row_count > 0) {
        const text = vterm_mod.getRowText(node.row_start);
        setStrProp(cx.iso, cx.ctx, obj, "text", text);
    }
    info.getReturnValue().set(obj.toValue());
}

fn hostSemCacheCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNum(info, callbackCtx(info).iso, semantic.cacheCount());
}

fn hostSemCacheEntry(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const idx = jsI32Arg(info, 0) orelse return setReturnUndefined(info, cx.iso);
    if (idx < 0) return setReturnUndefined(info, cx.iso);
    const entry = semantic.getCacheEntry(@intCast(idx)) orelse return setReturnUndefined(info, cx.iso);
    const obj = v8.Object.init(cx.iso);
    setNumProp(cx.iso, cx.ctx, obj, "row", entry.row);
    setStrProp(cx.iso, cx.ctx, obj, "kind", @tagName(entry.kind));
    setNumProp(cx.iso, cx.ctx, obj, "turn_id", entry.turn_id);
    setNumProp(cx.iso, cx.ctx, obj, "group_id", entry.group_id);
    setStrProp(cx.iso, cx.ctx, obj, "text", vterm_mod.getRowText(entry.row));
    info.getReturnValue().set(obj.toValue());
}

fn hostSemRowToken(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const row = jsI32Arg(info, 0) orelse return setReturnUndefined(info, cx.iso);
    if (row < 0) return setReturnUndefined(info, cx.iso);
    setReturnString(info, cx.iso, @tagName(classifier.getRowToken(@intCast(row))));
}

fn hostSemRowText(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);
    const row = jsI32Arg(info, 0) orelse return setReturnUndefined(info, cx.iso);
    if (row < 0) return setReturnUndefined(info, cx.iso);
    setReturnString(info, cx.iso, vterm_mod.getRowText(@intCast(row)));
}

fn hostSemTree(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [4096]u8 = undefined;
    const tree = semantic.formatTree(&buf);
    setReturnString(info, callbackCtx(info).iso, tree);
}

fn hostSemSetMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return setReturnUndefined(info, callbackCtx(info).iso);
    const mode = jsI32Arg(info, 0) orelse return setReturnUndefined(info, callbackCtx(info).iso);
    classifier.setMode(switch (mode) {
        1 => .basic,
        2 => .claude_code,
        3 => .json,
        else => .none,
    });
    classifier.markDirty();
    setReturnUndefined(info, callbackCtx(info).iso);
}

fn hostSemHasDiff(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNum(info, callbackCtx(info).iso, if (semantic.hasDiff()) 1 else 0);
}

fn hostSemFrame(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNum(info, callbackCtx(info).iso, semantic.getFrame());
}

fn hostSemExport(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const count = semantic.cacheCount();
    const arr = v8.Array.init(cx.iso, @intCast(count));
    var i: u16 = 0;
    while (i < count) : (i += 1) {
        const entry = semantic.getCacheEntry(i) orelse continue;
        const obj = v8.Object.init(cx.iso);
        setNumProp(cx.iso, cx.ctx, obj, "row", entry.row);
        setStrProp(cx.iso, cx.ctx, obj, "kind", @tagName(entry.kind));
        setNumProp(cx.iso, cx.ctx, obj, "turn_id", entry.turn_id);
        setNumProp(cx.iso, cx.ctx, obj, "group_id", entry.group_id);
        setStrProp(cx.iso, cx.ctx, obj, "text", vterm_mod.getRowText(entry.row));
        const tc = classifier.tokenColor(entry.kind);
        var hex_buf: [8]u8 = undefined;
        const hex = std.fmt.bufPrint(&hex_buf, "#{x:0>2}{x:0>2}{x:0>2}", .{ tc.r, tc.g, tc.b }) catch "#e2e8f0";
        setStrProp(cx.iso, cx.ctx, obj, "color", hex);
        _ = arr.castTo(v8.Object).setValueAtIndex(cx.ctx, @intCast(i), obj.toValue());
    }
    info.getReturnValue().set(arr.castTo(v8.Object).toValue());
}

fn hostSemSnapshot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    const root = v8.Object.init(cx.iso);
    setNumProp(cx.iso, cx.ctx, root, "version", 1.0);
    const cls_name = switch (classifier.getMode()) {
        .none => "none",
        .basic => "basic",
        .claude_code => "claude_code",
        .json => "json",
    };
    setStrProp(cx.iso, cx.ctx, root, "classifier", cls_name);
    setNumProp(cx.iso, cx.ctx, root, "frame", semantic.getFrame());

    const s = semantic.getState();
    const st = v8.Object.init(cx.iso);
    setStrProp(cx.iso, cx.ctx, st, "mode", @tagName(s.mode));
    setBoolProp(cx.iso, cx.ctx, st, "streaming", s.streaming);
    setStrProp(cx.iso, cx.ctx, st, "streaming_kind", @tagName(s.streaming_kind));
    setBoolProp(cx.iso, cx.ctx, st, "awaiting_input", s.awaiting_input);
    setBoolProp(cx.iso, cx.ctx, st, "awaiting_decision", s.awaiting_decision);
    setBoolProp(cx.iso, cx.ctx, st, "modal_open", s.modal_open);
    setBoolProp(cx.iso, cx.ctx, st, "interrupt_pending", s.interrupt_pending);
    setNumProp(cx.iso, cx.ctx, st, "turn_count", s.turn_count);
    setNumProp(cx.iso, cx.ctx, st, "current_turn_id", s.current_turn_id);
    setNumProp(cx.iso, cx.ctx, st, "node_count", s.node_count);
    setNumProp(cx.iso, cx.ctx, st, "group_count", s.group_count);
    _ = root.setValue(cx.ctx, v8.String.initUtf8(cx.iso, "state"), st.toValue());

    const count = semantic.cacheCount();
    const rows = v8.Array.init(cx.iso, @intCast(count));
    var i: u16 = 0;
    while (i < count) : (i += 1) {
        const entry = semantic.getCacheEntry(i) orelse continue;
        const obj = v8.Object.init(cx.iso);
        setNumProp(cx.iso, cx.ctx, obj, "row", entry.row);
        setStrProp(cx.iso, cx.ctx, obj, "kind", @tagName(entry.kind));
        setStrProp(cx.iso, cx.ctx, obj, "role", @tagName(semantic.roleOf(entry.kind)));
        setStrProp(cx.iso, cx.ctx, obj, "lane", @tagName(semantic.laneOf(entry.kind)));
        setNumProp(cx.iso, cx.ctx, obj, "turn_id", entry.turn_id);
        setNumProp(cx.iso, cx.ctx, obj, "group_id", entry.group_id);
        setStrProp(cx.iso, cx.ctx, obj, "text", vterm_mod.getRowText(entry.row));
        const tc = classifier.tokenColor(entry.kind);
        var hb: [8]u8 = undefined;
        const hx = std.fmt.bufPrint(&hb, "#{x:0>2}{x:0>2}{x:0>2}", .{ tc.r, tc.g, tc.b }) catch "#e2e8f0";
        setStrProp(cx.iso, cx.ctx, obj, "color", hx);
        _ = rows.castTo(v8.Object).setValueAtIndex(cx.ctx, @intCast(i), obj.toValue());
    }
    _ = root.setValue(cx.ctx, v8.String.initUtf8(cx.iso, "rows"), rows.castTo(v8.Object).toValue());

    const g = v8.Object.init(cx.iso);
    setNumProp(cx.iso, cx.ctx, g, "node_count", semantic.nodeCount());
    setNumProp(cx.iso, cx.ctx, g, "turn_count", s.turn_count);
    var tree_buf: [4096]u8 = undefined;
    setStrProp(cx.iso, cx.ctx, g, "tree", semantic.formatTree(&tree_buf));
    _ = root.setValue(cx.ctx, v8.String.initUtf8(cx.iso, "graph"), g.toValue());

    info.getReturnValue().set(root.toValue());
}

fn hostSemSetRowToken(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return setReturnUndefined(info, callbackCtx(info).iso);
    const cx = callbackCtx(info);
    const row = jsI32Arg(info, 0) orelse return setReturnUndefined(info, cx.iso);
    if (row < 0) return setReturnUndefined(info, cx.iso);
    const name = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(name);
    classifier.setRowToken(@intCast(row), classifier.tokenFromName(name));
    setReturnUndefined(info, cx.iso);
}

fn hostSemVtermRows(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNum(info, callbackCtx(info).iso, vterm_mod.getRows());
}

fn hostSemBuildGraph(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    var rows: i32 = 0;
    if (info.length() >= 1) rows = jsI32Arg(info, 0) orelse 0;
    if (rows <= 0) rows = @intCast(vterm_mod.getRows());
    semantic.tick(@intCast(rows));
    setReturnUndefined(info, cx.iso);
}

fn emitChannelPayload(host: *HostContext, channel: []const u8, payload: []const u8) void {
    const alloc = std.heap.page_allocator;
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

    v8rt.callGlobal2Str(host, "__ffiEmit", chan_z, payload_z);
}

/// Register a Zig-side streaming HTTP consumer. The request runs through
/// net_http's worker pool; chunks land in the shared response_queue and
/// get dispatched by tickDrain. When tickDrain sees a response whose id
/// has zig callbacks attached, it calls the callbacks instead of emitting
/// to JS via __ffiEmit.
///
/// Returns the assigned id on success, null on failure. Caller doesn't
/// need to retain the id — it's used only for routing the response.
/// Callbacks fire on the main thread (during tickDrain).
pub fn httpStartZigStream(
    io: std.Io,
    environ: *const std.process.Environ.Map,
    opts: net_http.RequestOpts,
    callbacks: HttpZigCallbacks,
) ?u32 {
    if (!g_http_init_done) {
        net_http.init(io, environ) catch return null;
        g_http_init_done = true;
    }
    g_http_zig_next_id +%= 1;
    if (g_http_zig_next_id < 0xF000_0000) g_http_zig_next_id = 0xF000_0000;
    const id = g_http_zig_next_id;
    const alloc = std.heap.page_allocator;
    const rid_copy = alloc.dupe(u8, "") catch return null;
    httpPending().put(id, .{
        .rid = rid_copy,
        .stream = true,
        .zig = callbacks,
    }) catch {
        alloc.free(rid_copy);
        return null;
    };
    if (!net_http.request(io, id, opts)) {
        if (httpPending().fetchRemove(id)) |entry| alloc.free(entry.value.rid);
        return null;
    }
    return id;
}

// Call this from the V8 app's main loop per tick.
pub fn tickDrain(host: *HostContext) void {
    if (g_http_init_done) {
        var buf: [8]net_http.Response = undefined;
        const n = net_http.poll(host.io, &buf);
        const alloc = std.heap.page_allocator;
        for (buf[0..n]) |resp| {
            var ch_buf: [256]u8 = undefined;

            if (httpPending().get(resp.id)) |pending| {
                if (pending.zig) |zcb| {
                    switch (resp.response_type) {
                        .chunk => zcb.onChunk(zcb.ctx, resp.bodySlice()),
                        .complete => {
                            zcb.onEnd(zcb.ctx, resp.status, null);
                            if (httpPending().fetchRemove(resp.id)) |entry| alloc.free(entry.value.rid);
                        },
                        .err => {
                            zcb.onEnd(zcb.ctx, 0, resp.errorSlice());
                            if (httpPending().fetchRemove(resp.id)) |entry| alloc.free(entry.value.rid);
                        },
                        .progress => {},
                    }
                    continue;
                }

                if (pending.download) {
                    // Download mode: progress chunks ride
                    // "http-download-progress:<rid>" with `{"d":dl,"t":total}`,
                    // terminal rides "http-download-end:<rid>" with status or
                    // error. Buffer sizes accommodate the JSON payload.
                    switch (resp.response_type) {
                        .progress => {
                            const ch = std.fmt.bufPrint(&ch_buf, "http-download-progress:{s}", .{pending.rid}) catch continue;
                            emitChannelPayload(host, ch, resp.bodySlice());
                        },
                        .complete => {
                            var payload_buf: [64]u8 = undefined;
                            const payload = std.fmt.bufPrint(&payload_buf, "{{\"status\":{d}}}", .{resp.status}) catch continue;
                            const ch = std.fmt.bufPrint(&ch_buf, "http-download-end:{s}", .{pending.rid}) catch continue;
                            emitChannelPayload(host, ch, payload);
                            if (httpPending().fetchRemove(resp.id)) |entry| alloc.free(entry.value.rid);
                        },
                        .err => {
                            var out: std.ArrayList(u8) = .empty;
                            defer out.deinit(alloc);
                            out.appendSlice(alloc, "{\"error\":") catch continue;
                            jsonEscape(&out, alloc, resp.errorSlice()) catch continue;
                            out.append(alloc, '}') catch continue;
                            const ch = std.fmt.bufPrint(&ch_buf, "http-download-end:{s}", .{pending.rid}) catch continue;
                            emitChannelPayload(host, ch, out.items);
                            if (httpPending().fetchRemove(resp.id)) |entry| alloc.free(entry.value.rid);
                        },
                        .chunk => {}, // not produced by download mode
                    }
                    continue;
                }

                if (!pending.stream) {
                    // Non-streaming: single full-body response → "http:<rid>"
                    const rid = httpPending().fetchRemove(resp.id) orelse continue;
                    defer alloc.free(rid.value.rid);
                    const payload = buildHttpRespJson(&resp, alloc) catch continue;
                    defer alloc.free(payload);
                    const ch = std.fmt.bufPrint(&ch_buf, "http:{s}", .{rid.value.rid}) catch continue;
                    emitChannelPayload(host, ch, payload);
                    continue;
                }

                // Streaming: chunks ride "http-stream:<rid>", terminal rides
                // "http-stream-end:<rid>" carrying status or error.
                switch (resp.response_type) {
                    .chunk => {
                        const ch = std.fmt.bufPrint(&ch_buf, "http-stream:{s}", .{pending.rid}) catch continue;
                        emitChannelPayload(host, ch, resp.bodySlice());
                    },
                    .complete => {
                        var payload_buf: [64]u8 = undefined;
                        const payload = std.fmt.bufPrint(&payload_buf, "{{\"status\":{d}}}", .{resp.status}) catch continue;
                        const ch = std.fmt.bufPrint(&ch_buf, "http-stream-end:{s}", .{pending.rid}) catch continue;
                        emitChannelPayload(host, ch, payload);
                        if (httpPending().fetchRemove(resp.id)) |entry| alloc.free(entry.value.rid);
                    },
                    .err => {
                        var out: std.ArrayList(u8) = .empty;
                        defer out.deinit(alloc);
                        out.appendSlice(alloc, "{\"error\":") catch continue;
                        jsonEscape(&out, alloc, resp.errorSlice()) catch continue;
                        out.append(alloc, '}') catch continue;
                        const ch = std.fmt.bufPrint(&ch_buf, "http-stream-end:{s}", .{pending.rid}) catch continue;
                        emitChannelPayload(host, ch, out.items);
                        if (httpPending().fetchRemove(resp.id)) |entry| alloc.free(entry.value.rid);
                    },
                    .progress => {},
                }
                continue;
            }

            // Browser page fallback — ids not in httpPending are looked up in pagePending
            if (pagePending().fetchRemove(resp.id)) |rid| {
                defer alloc.free(rid.value);
                const payload = buildPageRespJson(&resp, alloc) catch continue;
                defer alloc.free(payload);
                const ch = std.fmt.bufPrint(&ch_buf, "browser-page:{s}", .{rid.value}) catch continue;
                emitChannelPayload(host, ch, payload);
                continue;
            }
        }
    }

    if (g_browse_init_done) {
        var buf: [8]browse_bridge.Response = undefined;
        const n = browse_bridge.poll(host.io, &buf);
        const alloc = std.heap.page_allocator;
        for (buf[0..n]) |resp| {
            defer alloc.free(resp.body);
            const rid = browsePending().fetchRemove(resp.id) orelse continue;
            defer alloc.free(rid.value);
            var ch_buf: [256]u8 = undefined;
            const ch = std.fmt.bufPrint(&ch_buf, "browse:{s}", .{rid.value}) catch continue;
            emitChannelPayload(host, ch, resp.body);
        }
    }
}

pub fn registerSdk(vm: anytype) void {
    _ = vm;
    v8rt.registerHostFn("__fetch", hostFetch);
    v8rt.registerHostFn("__http_request_sync", hostHttpRequestSync);
    v8rt.registerHostFn("__http_request_async", hostHttpRequestAsync);
    v8rt.registerHostFn("__http_stream_open", hostHttpStreamOpen);
    v8rt.registerHostFn("__http_stream_close", hostHttpStreamClose);
    v8rt.registerHostFn("__http_download_to_file", hostHttpDownloadToFile);
    v8rt.registerHostFn("__browser_page_sync", hostBrowserPageSync);
    v8rt.registerHostFn("__browser_page_async", hostBrowserPageAsync);
    v8rt.registerHostFn("__browse_request_sync", hostBrowseRequestSync);
    v8rt.registerHostFn("__browse_request_async", hostBrowseRequestAsync);
    v8rt.registerHostFn("__browse_set_port", hostBrowseSetPort);
    if (HAS_TERMINAL) {
        v8rt.registerHostFn("__play_load", hostPlayLoad);
        v8rt.registerHostFn("__play_play", hostPlayPlay);
        v8rt.registerHostFn("__play_pause", hostPlayPause);
        v8rt.registerHostFn("__play_toggle", hostPlayToggle);
        v8rt.registerHostFn("__play_seek", hostPlaySeek);
        v8rt.registerHostFn("__play_step", hostPlayStep);
        v8rt.registerHostFn("__play_speed", hostPlaySpeed);
        v8rt.registerHostFn("__play_state", hostPlayState);
        v8rt.registerHostFn("__rec_start", hostRecStart);
        v8rt.registerHostFn("__rec_stop", hostRecStop);
        v8rt.registerHostFn("__rec_toggle", hostRecToggle);
        v8rt.registerHostFn("__rec_save", hostRecSave);
        v8rt.registerHostFn("__rec_is_recording", hostRecIsRecording);
        v8rt.registerHostFn("__rec_frame_count", hostRecFrameCount);
    }
    v8rt.registerHostFn("__ipc_connect", hostIpcConnect);
    v8rt.registerHostFn("__ipc_disconnect", hostIpcDisconnect);
    v8rt.registerHostFn("__ipc_status", hostIpcStatus);
    v8rt.registerHostFn("__ipc_perf", hostIpcPerf);
    v8rt.registerHostFn("__ipc_poll", hostIpcPoll);
    v8rt.registerHostFn("__ipc_enable_telemetry", hostIpcEnableTelemetry);
    v8rt.registerHostFn("__ipc_request", hostIpcRequest);
    v8rt.registerHostFn("__ipc_request_node", hostIpcRequestNode);
    v8rt.registerHostFn("__ipc_response", hostIpcResponse);
    v8rt.registerHostFn("__ipc_submit_code", hostIpcSubmitCode);
    v8rt.registerHostFn("__ipc_tree_count", hostIpcTreeCount);
    v8rt.registerHostFn("__ipc_tree_node", hostIpcTreeNode);
    if (HAS_TERMINAL) {
        v8rt.registerHostFn("__sem_build_graph", hostSemBuildGraph);
        v8rt.registerHostFn("__sem_cache_count", hostSemCacheCount);
        v8rt.registerHostFn("__sem_cache_entry", hostSemCacheEntry);
        v8rt.registerHostFn("__sem_export", hostSemExport);
        v8rt.registerHostFn("__sem_frame", hostSemFrame);
        v8rt.registerHostFn("__sem_has_diff", hostSemHasDiff);
        v8rt.registerHostFn("__sem_node_count", hostSemNodeCount);
        v8rt.registerHostFn("__sem_node", hostSemNode);
        v8rt.registerHostFn("__sem_row_text", hostSemRowText);
        v8rt.registerHostFn("__sem_row_token", hostSemRowToken);
        v8rt.registerHostFn("__sem_set_mode", hostSemSetMode);
        v8rt.registerHostFn("__sem_set_row_token", hostSemSetRowToken);
        v8rt.registerHostFn("__sem_snapshot", hostSemSnapshot);
        v8rt.registerHostFn("__sem_state", hostSemState);
        v8rt.registerHostFn("__sem_tree", hostSemTree);
        v8rt.registerHostFn("__sem_vterm_rows", hostSemVtermRows);
    }

    worker_bindings.register();
}
