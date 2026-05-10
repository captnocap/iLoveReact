//! V8 host bindings for filesystem, process, window, canvas, and theme helpers.
//!
//! Mirrors the QJS-era bindings without changing the existing Zig impls.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");

const engine = @import("engine.zig");
// Terminal-dock-resize state — was housed in qjs_runtime.zig, now in
// framework/prepared_input.zig (archive/qjs-stack/README.md). Aliased
// as `qjs_runtime` to keep existing call sites working.
const prepared_input = @import("prepared_input.zig");
const canvas = @import("canvas.zig");
const process_mod = @import("process/process.zig");
const svg_path = @import("gpu/svg/path.zig");
const theme = @import("theme.zig");
const windows = @import("windows.zig");
const log = @import("diag/log.zig");

extern fn getpid() c_int;
extern fn popen(command: [*:0]const u8, mode: [*:0]const u8) ?*anyopaque;
extern fn pclose(stream: *anyopaque) c_int;
extern fn fread(ptr: [*]u8, size: usize, nmemb: usize, stream: *anyopaque) usize;
extern fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
extern fn exit(code: c_int) noreturn;

var g_app_dir_buf: [4096]u8 = undefined;
var g_app_dir_len: usize = 0;
var g_app_dir_resolved: bool = false;

fn currentContext(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn argStringAlloc(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (info.length() <= idx) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const len = str.lenUtf8(iso);
    const buf = alloc.alloc(u8, len) catch return null;
    _ = str.writeUtf8(iso, buf);
    return buf;
}

fn setValue(info: v8.FunctionCallbackInfo, value: anytype) void {
    info.getReturnValue().set(value);
}

fn setUndefined(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initUndefined(info.getIsolate()).toValue());
}

fn setNull(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initNull(info.getIsolate()).toValue());
}

fn setBool(info: v8.FunctionCallbackInfo, value: bool) void {
    setValue(info, v8.Boolean.init(info.getIsolate(), value));
}

fn setNumber(info: v8.FunctionCallbackInfo, value: anytype) void {
    const num: f64 = switch (@typeInfo(@TypeOf(value))) {
        .float => @floatCast(value),
        .int, .comptime_int => @floatFromInt(value),
        else => @compileError("setNumber only supports ints and floats"),
    };
    setValue(info, v8.Number.init(info.getIsolate(), num));
}

fn setString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    const iso = info.getIsolate();
    setValue(info, v8.String.initUtf8(iso, value));
}

fn appendJsonEscaped(out: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |ch| {
        switch (ch) {
            '"' => try out.appendSlice(alloc, "\\\""),
            '\\' => try out.appendSlice(alloc, "\\\\"),
            '\n' => try out.appendSlice(alloc, "\\n"),
            '\r' => try out.appendSlice(alloc, "\\r"),
            '\t' => try out.appendSlice(alloc, "\\t"),
            0...8, 11, 12, 14...31 => try out.writer(alloc).print("\\u{x:0>4}", .{ch}),
            else => try out.append(alloc, ch),
        }
    }
    try out.append(alloc, '"');
}

const MediaType = enum {
    video,
    audio,
    image,
    subtitle,
    document,
    archive,
    metadata,
    unknown,
};

fn mediaTypeLabel(t: MediaType) []const u8 {
    return switch (t) {
        .video => "video",
        .audio => "audio",
        .image => "image",
        .subtitle => "subtitle",
        .document => "document",
        .archive => "archive",
        .metadata => "metadata",
        .unknown => "unknown",
    };
}

fn mediaTypeFromFilename(name: []const u8) MediaType {
    const ext = std.fs.path.extension(name);
    if (ext.len <= 1) return .unknown;
    const e = ext[1..];
    // Bare ".ts" is intentionally NOT classified as video — it's overloaded
    // with TypeScript source files, and any cart living in a TS source tree
    // would have its own theme.ts / index.tsx classified as video and fed
    // to libmpv → "Failed to recognize file format." spam. Use the
    // unambiguous MPEG-TS container extensions m2ts / mts instead.
    if (std.ascii.eqlIgnoreCase(e, "mp4") or std.ascii.eqlIgnoreCase(e, "mkv") or std.ascii.eqlIgnoreCase(e, "avi") or std.ascii.eqlIgnoreCase(e, "mov") or std.ascii.eqlIgnoreCase(e, "wmv") or std.ascii.eqlIgnoreCase(e, "webm") or std.ascii.eqlIgnoreCase(e, "flv") or std.ascii.eqlIgnoreCase(e, "m4v") or std.ascii.eqlIgnoreCase(e, "mpg") or std.ascii.eqlIgnoreCase(e, "mpeg") or std.ascii.eqlIgnoreCase(e, "m2ts") or std.ascii.eqlIgnoreCase(e, "mts") or std.ascii.eqlIgnoreCase(e, "vob") or std.ascii.eqlIgnoreCase(e, "ogv") or std.ascii.eqlIgnoreCase(e, "3gp")) return .video;
    if (std.ascii.eqlIgnoreCase(e, "mp3") or std.ascii.eqlIgnoreCase(e, "flac") or std.ascii.eqlIgnoreCase(e, "ogg") or std.ascii.eqlIgnoreCase(e, "wav") or std.ascii.eqlIgnoreCase(e, "aac") or std.ascii.eqlIgnoreCase(e, "m4a") or std.ascii.eqlIgnoreCase(e, "wma") or std.ascii.eqlIgnoreCase(e, "opus") or std.ascii.eqlIgnoreCase(e, "aiff") or std.ascii.eqlIgnoreCase(e, "ape") or std.ascii.eqlIgnoreCase(e, "alac")) return .audio;
    if (std.ascii.eqlIgnoreCase(e, "jpg") or std.ascii.eqlIgnoreCase(e, "jpeg") or std.ascii.eqlIgnoreCase(e, "png") or std.ascii.eqlIgnoreCase(e, "gif") or std.ascii.eqlIgnoreCase(e, "bmp") or std.ascii.eqlIgnoreCase(e, "webp") or std.ascii.eqlIgnoreCase(e, "svg") or std.ascii.eqlIgnoreCase(e, "tiff") or std.ascii.eqlIgnoreCase(e, "tif") or std.ascii.eqlIgnoreCase(e, "ico") or std.ascii.eqlIgnoreCase(e, "heic") or std.ascii.eqlIgnoreCase(e, "heif") or std.ascii.eqlIgnoreCase(e, "avif") or std.ascii.eqlIgnoreCase(e, "raw")) return .image;
    if (std.ascii.eqlIgnoreCase(e, "srt") or std.ascii.eqlIgnoreCase(e, "ass") or std.ascii.eqlIgnoreCase(e, "ssa") or std.ascii.eqlIgnoreCase(e, "sub") or std.ascii.eqlIgnoreCase(e, "vtt") or std.ascii.eqlIgnoreCase(e, "idx")) return .subtitle;
    if (std.ascii.eqlIgnoreCase(e, "pdf") or std.ascii.eqlIgnoreCase(e, "epub") or std.ascii.eqlIgnoreCase(e, "mobi") or std.ascii.eqlIgnoreCase(e, "djvu") or std.ascii.eqlIgnoreCase(e, "txt") or std.ascii.eqlIgnoreCase(e, "md") or std.ascii.eqlIgnoreCase(e, "doc") or std.ascii.eqlIgnoreCase(e, "docx") or std.ascii.eqlIgnoreCase(e, "rtf") or std.ascii.eqlIgnoreCase(e, "odt")) return .document;
    if (std.ascii.eqlIgnoreCase(e, "zip") or std.ascii.eqlIgnoreCase(e, "rar") or std.ascii.eqlIgnoreCase(e, "7z") or std.ascii.eqlIgnoreCase(e, "tar") or std.ascii.eqlIgnoreCase(e, "gz") or std.ascii.eqlIgnoreCase(e, "bz2") or std.ascii.eqlIgnoreCase(e, "xz") or std.ascii.eqlIgnoreCase(e, "zst") or std.ascii.eqlIgnoreCase(e, "iso") or std.ascii.eqlIgnoreCase(e, "cab") or std.ascii.eqlIgnoreCase(e, "lz4")) return .archive;
    if (std.ascii.eqlIgnoreCase(e, "nfo") or std.ascii.eqlIgnoreCase(e, "xml")) return .metadata;
    return .unknown;
}

const MediaScanOptions = struct {
    recursive: bool = true,
    max_depth: u32 = 10,
};

const MediaLargest = struct {
    path: []u8,
    name: []u8,
    size: u64,
    mtime_sec: i64,
    media_type: MediaType,
};

const MediaStatsAcc = struct {
    total: u64 = 0,
    total_size: u64 = 0,
    count_video: u64 = 0,
    count_audio: u64 = 0,
    count_image: u64 = 0,
    count_subtitle: u64 = 0,
    count_document: u64 = 0,
    count_archive: u64 = 0,
    count_metadata: u64 = 0,
    count_unknown: u64 = 0,
    largest: ?MediaLargest = null,

    fn deinit(self: *MediaStatsAcc, alloc: std.mem.Allocator) void {
        if (self.largest) |l| {
            alloc.free(l.path);
            alloc.free(l.name);
        }
    }
};

fn mediaStatsCountPtr(stats: *MediaStatsAcc, t: MediaType) *u64 {
    return switch (t) {
        .video => &stats.count_video,
        .audio => &stats.count_audio,
        .image => &stats.count_image,
        .subtitle => &stats.count_subtitle,
        .document => &stats.count_document,
        .archive => &stats.count_archive,
        .metadata => &stats.count_metadata,
        .unknown => &stats.count_unknown,
    };
}

fn appendMediaFileJson(
    out: *std.ArrayList(u8),
    alloc: std.mem.Allocator,
    first: *bool,
    full_path: []const u8,
    name: []const u8,
    size: u64,
    mtime_sec: i64,
    t: MediaType,
) !void {
    if (!first.*) try out.append(alloc, ',');
    first.* = false;
    try out.appendSlice(alloc, "{\"path\":");
    try appendJsonEscaped(out, alloc, full_path);
    try out.appendSlice(alloc, ",\"name\":");
    try appendJsonEscaped(out, alloc, name);
    try out.writer(alloc).print(",\"size\":{d},\"mtime\":{d},\"type\":\"{s}\",\"source\":\"filesystem\"}}", .{
        size,
        mtime_sec,
        mediaTypeLabel(t),
    });
}

fn scanMediaDirRecursive(
    alloc: std.mem.Allocator,
    base_path: []const u8,
    depth: u32,
    opts: MediaScanOptions,
    maybe_out: ?*std.ArrayList(u8),
    first: *bool,
    stats: *MediaStatsAcc,
) void {
    var dir = std.fs.cwd().openDir(base_path, .{ .iterate = true }) catch return;
    defer dir.close();

    var iter = dir.iterate();
    while (iter.next() catch null) |entry| {
        const child_path = std.fmt.allocPrint(alloc, "{s}/{s}", .{ base_path, entry.name }) catch continue;
        defer alloc.free(child_path);

        switch (entry.kind) {
            .directory => {
                if (opts.recursive and depth < opts.max_depth) {
                    scanMediaDirRecursive(alloc, child_path, depth + 1, opts, maybe_out, first, stats);
                }
            },
            .file => {
                const st = std.fs.cwd().statFile(child_path) catch continue;
                const t = mediaTypeFromFilename(entry.name);
                const mtime_sec: i64 = @intCast(@divTrunc(st.mtime, std.time.ns_per_s));
                const size_u64: u64 = st.size;

                stats.total += 1;
                stats.total_size += size_u64;
                mediaStatsCountPtr(stats, t).* += 1;

                if (stats.largest == null or size_u64 > stats.largest.?.size) {
                    if (stats.largest) |old| {
                        alloc.free(old.path);
                        alloc.free(old.name);
                    }
                    const largest_path = alloc.dupe(u8, child_path) catch continue;
                    const largest_name = alloc.dupe(u8, entry.name) catch {
                        alloc.free(largest_path);
                        continue;
                    };
                    stats.largest = .{
                        .path = largest_path,
                        .name = largest_name,
                        .size = size_u64,
                        .mtime_sec = mtime_sec,
                        .media_type = t,
                    };
                }

                if (maybe_out) |out| {
                    appendMediaFileJson(out, alloc, first, child_path, entry.name, size_u64, mtime_sec, t) catch {};
                }
            },
            else => {},
        }
    }
}

fn argBoolDefault(info: v8.FunctionCallbackInfo, idx: u32, default_value: bool) bool {
    if (info.length() <= idx) return default_value;
    const ctx = currentContext(info);
    const i = info.getArg(idx).toI32(ctx) catch return default_value;
    return i != 0;
}

fn argU32Default(info: v8.FunctionCallbackInfo, idx: u32, default_value: u32) u32 {
    if (info.length() <= idx) return default_value;
    const ctx = currentContext(info);
    const i = info.getArg(idx).toI32(ctx) catch return default_value;
    if (i < 0) return default_value;
    return @intCast(i);
}

fn fsMediaScanJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const dir_path = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "[]");
        return;
    };
    defer alloc.free(dir_path);

    const opts = MediaScanOptions{
        .recursive = argBoolDefault(info, 1, true),
        .max_depth = argU32Default(info, 2, 10),
    };

    var out: std.ArrayList(u8) = .{};
    defer out.deinit(alloc);
    var stats = MediaStatsAcc{};
    defer stats.deinit(alloc);
    var first = true;

    out.append(alloc, '[') catch {
        setString(info, "[]");
        return;
    };
    scanMediaDirRecursive(alloc, dir_path, 0, opts, &out, &first, &stats);
    out.append(alloc, ']') catch {
        setString(info, "[]");
        return;
    };
    setString(info, out.items);
}

fn appendByTypeCounts(out: *std.ArrayList(u8), alloc: std.mem.Allocator, stats: MediaStatsAcc) !void {
    var first = true;
    const entries = [_]struct { key: []const u8, value: u64 }{
        .{ .key = "video", .value = stats.count_video },
        .{ .key = "audio", .value = stats.count_audio },
        .{ .key = "image", .value = stats.count_image },
        .{ .key = "subtitle", .value = stats.count_subtitle },
        .{ .key = "document", .value = stats.count_document },
        .{ .key = "archive", .value = stats.count_archive },
        .{ .key = "metadata", .value = stats.count_metadata },
        .{ .key = "unknown", .value = stats.count_unknown },
    };
    for (entries) |e| {
        if (e.value == 0) continue;
        if (!first) try out.append(alloc, ',');
        first = false;
        try out.writer(alloc).print("\"{s}\":{d}", .{ e.key, e.value });
    }
}

fn fsMediaStatsJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const dir_path = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "{\"total\":0,\"byType\":{},\"totalSize\":0,\"largestFile\":null}");
        return;
    };
    defer alloc.free(dir_path);

    const opts = MediaScanOptions{
        .recursive = argBoolDefault(info, 1, true),
        .max_depth = argU32Default(info, 2, 10),
    };

    var stats = MediaStatsAcc{};
    defer stats.deinit(alloc);
    var first_dummy = true;
    scanMediaDirRecursive(alloc, dir_path, 0, opts, null, &first_dummy, &stats);

    var out: std.ArrayList(u8) = .{};
    defer out.deinit(alloc);

    out.appendSlice(alloc, "{\"total\":") catch {
        setString(info, "{\"total\":0,\"byType\":{},\"totalSize\":0,\"largestFile\":null}");
        return;
    };
    out.writer(alloc).print("{d},\"byType\":{{", .{stats.total}) catch {
        setString(info, "{\"total\":0,\"byType\":{},\"totalSize\":0,\"largestFile\":null}");
        return;
    };
    appendByTypeCounts(&out, alloc, stats) catch {};
    out.writer(alloc).print("}},\"totalSize\":{d},\"largestFile\":", .{stats.total_size}) catch {
        setString(info, "{\"total\":0,\"byType\":{},\"totalSize\":0,\"largestFile\":null}");
        return;
    };

    if (stats.largest) |largest| {
        out.appendSlice(alloc, "{\"path\":") catch {};
        appendJsonEscaped(&out, alloc, largest.path) catch {};
        out.appendSlice(alloc, ",\"name\":") catch {};
        appendJsonEscaped(&out, alloc, largest.name) catch {};
        out.writer(alloc).print(",\"size\":{d},\"mtime\":{d},\"type\":\"{s}\",\"source\":\"filesystem\"}}", .{
            largest.size,
            largest.mtime_sec,
            mediaTypeLabel(largest.media_type),
        }) catch {};
    } else {
        out.appendSlice(alloc, "null") catch {};
    }

    out.append(alloc, '}') catch {};
    setString(info, out.items);
}

fn fsMediaIndexJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    // Current V8 coverage: same as scan (filesystem index).
    // Args beyond scan parity (e.g. archive options) are accepted by JS but ignored here.
    fsMediaScanJson(info_c);
}

fn resolveAppDir() usize {
    if (g_app_dir_resolved) return g_app_dir_len;
    g_app_dir_resolved = true;

    const exe_path = std.posix.readlink("/proc/self/exe", &g_app_dir_buf) catch return 0;
    var dir_end: usize = exe_path.len;
    while (dir_end > 0 and g_app_dir_buf[dir_end - 1] != '/') dir_end -= 1;
    if (dir_end == 0) return 0;

    if (dir_end >= 4 and std.mem.eql(u8, g_app_dir_buf[dir_end - 4 .. dir_end], "lib/")) {
        dir_end -= 4;
        if (dir_end == 0 or g_app_dir_buf[dir_end - 1] != '/') {
            while (dir_end > 0 and g_app_dir_buf[dir_end - 1] != '/') dir_end -= 1;
        }
    }

    g_app_dir_len = dir_end;
    return dir_end;
}

fn fsRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path_alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(path_alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer path_alloc.free(path_buf);

    const data = std.fs.cwd().readFileAlloc(path_alloc, path_buf, 16 * 1024 * 1024) catch {
        setNull(info);
        return;
    };
    defer path_alloc.free(data);
    setString(info, data);
}

fn fsWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path_buf);
    const content_buf = argStringAlloc(alloc, info, 1) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(content_buf);

    if (std.mem.lastIndexOfScalar(u8, path_buf, '/')) |idx| {
        std.fs.cwd().makePath(path_buf[0..idx]) catch {};
    }
    const file = std.fs.cwd().createFile(path_buf, .{ .truncate = true }) catch {
        setBool(info, false);
        return;
    };
    defer file.close();
    file.writeAll(content_buf) catch {
        setBool(info, false);
        return;
    };
    setBool(info, true);
}

fn fsExists(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path_buf);
    _ = std.fs.cwd().statFile(path_buf) catch {
        setBool(info, false);
        return;
    };
    setBool(info, true);
}

fn fsListJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "[]");
        return;
    };
    defer alloc.free(path_buf);

    var out: std.ArrayList(u8) = .{};
    defer out.deinit(alloc);
    out.append(alloc, '[') catch {
        setString(info, "[]");
        return;
    };

    var dir = std.fs.cwd().openDir(path_buf, .{ .iterate = true }) catch {
        out.append(alloc, ']') catch {};
        setString(info, out.items);
        return;
    };
    defer dir.close();

    var first = true;
    var iter = dir.iterate();
    while (iter.next() catch null) |entry| {
        if (!first) out.append(alloc, ',') catch break;
        first = false;
        appendJsonEscaped(&out, alloc, entry.name) catch break;
    }
    out.append(alloc, ']') catch {
        setString(info, "[]");
        return;
    };
    setString(info, out.items);
}

fn fsMkdir(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path_buf);
    std.fs.cwd().makePath(path_buf) catch {
        setBool(info, false);
        return;
    };
    setBool(info, true);
}

fn fsRemove(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path_buf);

    const stat = std.fs.cwd().statFile(path_buf) catch {
        setBool(info, false);
        return;
    };
    switch (stat.kind) {
        .directory => std.fs.cwd().deleteDir(path_buf) catch {
            setBool(info, false);
            return;
        },
        else => std.fs.cwd().deleteFile(path_buf) catch {
            setBool(info, false);
            return;
        },
    }
    setBool(info, true);
}

fn fsStatJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(path_buf);

    const st = std.fs.cwd().statFile(path_buf) catch {
        setNull(info);
        return;
    };
    const mtime_ms: i64 = @intCast(@divTrunc(st.mtime, std.time.ns_per_ms));
    const is_dir = st.kind == .directory;

    var buf: [256]u8 = undefined;
    const s = std.fmt.bufPrint(
        &buf,
        "{{\"size\":{d},\"mtimeMs\":{d},\"isDir\":{s}}}",
        .{ st.size, mtime_ms, if (is_dir) "true" else "false" },
    ) catch {
        setNull(info);
        return;
    };
    setString(info, s);
}

fn fsReadfile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "");
        return;
    };
    defer alloc.free(path_buf);

    const data = std.fs.cwd().readFileAlloc(alloc, path_buf, 16 * 1024 * 1024) catch {
        setString(info, "");
        return;
    };
    defer alloc.free(data);
    setString(info, data);
}

fn fsWritefile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(path_buf);
    const content_buf = argStringAlloc(alloc, info, 1) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(content_buf);

    if (std.mem.lastIndexOfScalar(u8, path_buf, '/')) |idx| {
        std.fs.cwd().makePath(path_buf[0..idx]) catch {};
    }
    const file = std.fs.cwd().createFile(path_buf, .{}) catch {
        setNumber(info, -1);
        return;
    };
    defer file.close();
    file.writeAll(content_buf) catch {
        setNumber(info, -1);
        return;
    };
    setNumber(info, 0);
}

fn fsDeletefile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(path_buf);
    std.fs.cwd().deleteFile(path_buf) catch {
        setNumber(info, -1);
        return;
    };
    setNumber(info, 0);
}

fn fsScandir(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        const arr = v8.Array.init(iso, 0);
        setValue(info, arr.castTo(v8.Object).toValue());
        return;
    };
    defer alloc.free(path_buf);

    var dir = std.fs.cwd().openDir(path_buf, .{ .iterate = true }) catch {
        const arr = v8.Array.init(iso, 0);
        setValue(info, arr.castTo(v8.Object).toValue());
        return;
    };
    defer dir.close();

    const arr = v8.Array.init(iso, 0);
    const obj = arr.castTo(v8.Object);
    var iter = dir.iterate();
    var i: u32 = 0;
    while (iter.next() catch null) |entry| {
        const name = v8.String.initUtf8(iso, entry.name);
        _ = obj.setValueAtIndex(ctx, i, name.toValue());
        i += 1;
    }
    setValue(info, arr.castTo(v8.Object).toValue());
}

fn execCmd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const cmd_buf = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "");
        return;
    };
    defer alloc.free(cmd_buf);

    const cmd_z = alloc.alloc(u8, cmd_buf.len + 1) catch {
        setString(info, "");
        return;
    };
    defer alloc.free(cmd_z);
    @memcpy(cmd_z[0..cmd_buf.len], cmd_buf);
    cmd_z[cmd_buf.len] = 0;
    const cmd_ptr: [*:0]const u8 = @ptrCast(cmd_z.ptr);

    const stream = popen(cmd_ptr, "r") orelse {
        setString(info, "");
        return;
    };
    var buf: [65536]u8 = undefined;
    var total: usize = 0;
    while (total < buf.len) {
        const n = fread(buf[total..].ptr, 1, buf.len - total, stream);
        if (n == 0) break;
        total += n;
    }
    _ = pclose(stream);
    if (total == 0) {
        setString(info, "");
        return;
    }
    setString(info, buf[0..total]);
}

fn getPid(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setNumber(info, @as(i64, getpid()));
}

fn getEnv(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const name_buf = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "");
        return;
    };
    defer alloc.free(name_buf);
    const val = std.posix.getenv(name_buf) orelse {
        setString(info, "");
        return;
    };
    setString(info, val);
}

fn envGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const name_buf = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(name_buf);
    const val = std.posix.getenv(name_buf) orelse {
        setNull(info);
        return;
    };
    setString(info, val);
}

fn envSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const name_buf = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(name_buf);
    const value_buf = argStringAlloc(alloc, info, 1) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(value_buf);

    const name_z = alloc.alloc(u8, name_buf.len + 1) catch {
        setUndefined(info);
        return;
    };
    defer alloc.free(name_z);
    @memcpy(name_z[0..name_buf.len], name_buf);
    name_z[name_buf.len] = 0;
    const value_z = alloc.alloc(u8, value_buf.len + 1) catch {
        setUndefined(info);
        return;
    };
    defer alloc.free(value_z);
    @memcpy(value_z[0..value_buf.len], value_buf);
    value_z[value_buf.len] = 0;

    _ = setenv(@ptrCast(name_z.ptr), @ptrCast(value_z.ptr), 1);
    setUndefined(info);
}

fn exitHost(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const code = if (info.length() > 0) info.getArg(0).toI32(currentContext(info)) catch 0 else 0;
    exit(code);
}

fn beginTerminalDockResize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) {
        setUndefined(info);
        return;
    }
    const ctx = currentContext(info);
    const start_y = info.getArg(0).toF64(ctx) catch 0;
    const start_height = info.getArg(1).toF64(ctx) catch 0;
    prepared_input.beginTerminalDockResize(@floatCast(start_y), @floatCast(start_height));
    setUndefined(info);
}

fn endTerminalDockResize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    prepared_input.endTerminalDockResize();
    setUndefined(info);
}

fn getTerminalDockResizeState(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const obj = v8.Object.init(iso);
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, "active"), v8.Number.init(iso, if (prepared_input.terminalDockResizeActive()) 1 else 0).toValue());
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, "startY"), v8.Number.init(iso, prepared_input.terminalDockResizeStartY()));
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, "startHeight"), v8.Number.init(iso, prepared_input.terminalDockResizeStartHeight()));
    setValue(info, obj.toValue());
}

fn getActiveNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (canvas.getActiveNode()) |idx| {
        setNumber(info, @as(i64, idx));
    } else {
        setNumber(info, -1);
    }
}

fn getSelectedNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (canvas.getSelectedNode()) |idx| {
        setNumber(info, @as(i64, idx));
    } else {
        setNumber(info, -1);
    }
}

fn setFlowEnabled(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setUndefined(info);
        return;
    }
    const mode_raw = info.getArg(0).toI32(currentContext(info)) catch 2;
    svg_path.setFlowMode(@intCast(@max(0, @min(2, mode_raw))));
    setUndefined(info);
}

fn setVariant(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setUndefined(info);
        return;
    }
    const raw = info.getArg(0).toI32(currentContext(info)) catch 0;
    theme.setVariant(@intCast(@max(0, @min(255, raw))));
    setUndefined(info);
}

fn setNodeDim(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) {
        setUndefined(info);
        return;
    }
    const ctx = currentContext(info);
    const idx = info.getArg(0).toI32(ctx) catch 0;
    const opacity = info.getArg(1).toF64(ctx) catch 1.0;
    canvas.setNodeDim(@intCast(@max(0, idx)), @floatCast(opacity));
    setUndefined(info);
}

fn resetNodeDim(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    canvas.resetNodeDim();
    setUndefined(info);
}

fn setPathFlow(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) {
        setUndefined(info);
        return;
    }
    const ctx = currentContext(info);
    const idx = info.getArg(0).toI32(ctx) catch 0;
    const enabled = info.getArg(1).toI32(ctx) catch 1;
    canvas.setFlowOverride(@intCast(@max(0, idx)), enabled != 0);
    setUndefined(info);
}

fn resetPathFlow(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    canvas.resetFlowOverride();
    setUndefined(info);
}

fn windowClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.windowClose();
    setUndefined(info);
}

fn windowMinimize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.windowMinimize();
    setUndefined(info);
}

fn windowMaximize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.windowMaximize();
    setUndefined(info);
}

fn windowIsMaximized(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setBool(info, engine.windowIsMaximized());
}

fn openWindow(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const title_buf = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(title_buf);
    if (info.length() < 3) {
        setUndefined(info);
        return;
    }

    const ctx = currentContext(info);
    var w: i32 = 400;
    var h: i32 = 400;
    w = info.getArg(1).toI32(ctx) catch w;
    h = info.getArg(2).toI32(ctx) catch h;

    const width: c_int = @intCast(w);
    const height: c_int = @intCast(h);
    var title_buf_z: [256:0]u8 = undefined;
    const copy_len = @min(title_buf.len, 255);
    @memcpy(title_buf_z[0..copy_len], title_buf[0..copy_len]);
    title_buf_z[copy_len] = 0;
    _ = windows.open(.{
        .title = &title_buf_z,
        .width = width,
        .height = height,
        .kind = .in_process,
    });
    setUndefined(info);
}

fn spawnSelf(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dir_len = resolveAppDir();
    if (dir_len == 0) {
        log.info(.engine, "spawn_self: failed to resolve app directory", .{});
        setNumber(info, -1);
        return;
    }

    const run_suffix = "run";
    if (dir_len + run_suffix.len >= g_app_dir_buf.len) {
        setNumber(info, -1);
        return;
    }

    var run_buf: [4096]u8 = undefined;
    @memcpy(run_buf[0..dir_len], g_app_dir_buf[0..dir_len]);
    @memcpy(run_buf[dir_len .. dir_len + run_suffix.len], run_suffix);
    run_buf[dir_len + run_suffix.len] = 0;
    const run_z: [*:0]const u8 = @ptrCast(run_buf[0 .. dir_len + run_suffix.len :0]);

    log.info(.engine, "spawn_self: run_path={s}", .{run_z});
    const child = process_mod.spawn(.{
        .exe = run_z,
        .env = &.{.{ .key = "TSZ_DEBUG", .value = "1" }},
        .new_session = false,
    }) catch |err| {
        log.info(.engine, "spawn_self: spawn failed: {s}", .{@errorName(err)});
        setNumber(info, -1);
        return;
    };
    log.info(.engine, "spawn_self: child pid={d}", .{child.pid});
    setNumber(info, @as(i64, child.pid));
}

fn getAppDir(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dir_len = resolveAppDir();
    if (dir_len == 0) {
        setString(info, "");
        return;
    }
    setString(info, g_app_dir_buf[0..dir_len]);
}

fn getRunPath(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dir_len = resolveAppDir();
    if (dir_len == 0) {
        setString(info, "");
        return;
    }
    const run_suffix = "run";
    if (dir_len + run_suffix.len >= g_app_dir_buf.len) {
        setString(info, "");
        return;
    }
    var buf: [4096]u8 = undefined;
    @memcpy(buf[0..dir_len], g_app_dir_buf[0..dir_len]);
    @memcpy(buf[dir_len .. dir_len + run_suffix.len], run_suffix);
    setString(info, buf[0 .. dir_len + run_suffix.len]);
}

pub fn registerFs(vm: anytype) void {
    _ = vm;
    v8_runtime.registerHostFn("__fs_read", fsRead);
    v8_runtime.registerHostFn("__fs_write", fsWrite);
    v8_runtime.registerHostFn("__fs_scandir", fsScandir);
    v8_runtime.registerHostFn("__fs_deletefile", fsDeletefile);
    v8_runtime.registerHostFn("__fs_readfile", fsReadfile);
    v8_runtime.registerHostFn("__fs_writefile", fsWritefile);
    v8_runtime.registerHostFn("__fs_exists", fsExists);
    v8_runtime.registerHostFn("__fs_list_json", fsListJson);
    v8_runtime.registerHostFn("__fs_stat_json", fsStatJson);
    v8_runtime.registerHostFn("__fs_mkdir", fsMkdir);
    v8_runtime.registerHostFn("__fs_remove", fsRemove);
    v8_runtime.registerHostFn("__fs_media_scan_json", fsMediaScanJson);
    v8_runtime.registerHostFn("__fs_media_stats_json", fsMediaStatsJson);
    v8_runtime.registerHostFn("__fs_media_index_json", fsMediaIndexJson);

    v8_runtime.registerHostFn("__window_close", windowClose);
    v8_runtime.registerHostFn("__windowClose", windowClose);
    v8_runtime.registerHostFn("__window_minimize", windowMinimize);
    v8_runtime.registerHostFn("__windowMinimize", windowMinimize);
    v8_runtime.registerHostFn("__window_maximize", windowMaximize);
    v8_runtime.registerHostFn("__windowMaximize", windowMaximize);
    v8_runtime.registerHostFn("__window_is_maximized", windowIsMaximized);
    v8_runtime.registerHostFn("__openWindow", openWindow);

    v8_runtime.registerHostFn("__getenv", getEnv);
    v8_runtime.registerHostFn("__env_get", envGet);
    v8_runtime.registerHostFn("__env_set", envSet);
    v8_runtime.registerHostFn("__getpid", getPid);
    v8_runtime.registerHostFn("__exec", execCmd);
    v8_runtime.registerHostFn("__exit", exitHost);
    v8_runtime.registerHostFn("__spawn_self", spawnSelf);
    v8_runtime.registerHostFn("__get_app_dir", getAppDir);
    v8_runtime.registerHostFn("__get_run_path", getRunPath);

    v8_runtime.registerHostFn("__beginTerminalDockResize", beginTerminalDockResize);
    v8_runtime.registerHostFn("__endTerminalDockResize", endTerminalDockResize);
    v8_runtime.registerHostFn("__getTerminalDockResizeState", getTerminalDockResizeState);

    v8_runtime.registerHostFn("getActiveNode", getActiveNode);
    v8_runtime.registerHostFn("getSelectedNode", getSelectedNode);
    v8_runtime.registerHostFn("setFlowEnabled", setFlowEnabled);
    v8_runtime.registerHostFn("setVariant", setVariant);
    v8_runtime.registerHostFn("setNodeDim", setNodeDim);
    v8_runtime.registerHostFn("resetNodeDim", resetNodeDim);
    v8_runtime.registerHostFn("setPathFlow", setPathFlow);
    v8_runtime.registerHostFn("resetPathFlow", resetPathFlow);
}
