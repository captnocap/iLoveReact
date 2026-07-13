//! V8 host bindings for filesystem operations.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const mapfile = @import("world/mapfile.zig");
const app_config = @import("fs/app_config.zig");


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

fn fsRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path_alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(path_alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer path_alloc.free(path_buf);

    // 256MB ceiling (was 16MB): the V20 store reads its model snapshot through this
    // door, and a snapshot with many painted models legitimately exceeds 16MB — the
    // old cap returned null, the store saw "no snapshot", FULL-REPLAYED the event log
    // and OOM'd, degrading the model roster to one entry (req_2089). Sanity cap only.
    const data = std.fs.cwd().readFileAlloc(path_alloc, path_buf, 256 * 1024 * 1024) catch {
        setNull(info);
        return;
    };
    defer path_alloc.free(data);
    setString(info, data);
}

fn fsReadBase64(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(path_buf);

    const data = std.fs.cwd().readFileAlloc(alloc, path_buf, 64 * 1024 * 1024) catch {
        setNull(info);
        return;
    };
    defer alloc.free(data);

    const enc = std.base64.standard.Encoder;
    const out_len = enc.calcSize(data.len);
    const out = alloc.alloc(u8, out_len) catch {
        setNull(info);
        return;
    };
    defer alloc.free(out);
    _ = enc.encode(out, data);
    setString(info, out);
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

/// __fs_config_dir(app_name) -> string|null. Resolves and creates the native
/// per-user configuration directory. Settings files live here; project data
/// and localstore deliberately do not.
fn fsConfigDir(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const app_name = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(app_name);
    const path = app_config.resolve(alloc, app_name) catch {
        setNull(info);
        return;
    };
    defer alloc.free(path);
    std.fs.cwd().makePath(path) catch {
        setNull(info);
        return;
    };
    setString(info, path);
}

/// Raw bytes from a Uint8Array / ArrayBufferView arg, borrowed in place (zero
/// copy). Pointer owned by V8 — valid only for the duration of the call.
fn argView(info: v8.FunctionCallbackInfo, idx: u32) ?[]const u8 {
    if (info.length() <= idx) return null;
    const v = info.getArg(idx);
    if (!v.isArrayBufferView()) return null;
    const view: v8.ArrayBufferView = .{ .handle = @ptrCast(v.handle) };
    const byte_len = view.getByteLength();
    if (byte_len == 0) return &[_]u8{};
    const byte_off = view.getByteOffset();
    const ab = view.getBuffer();
    var shared = ab.getBackingStore();
    defer v8.BackingStore.sharedPtrReset(&shared);
    const bs = v8.BackingStore.sharedPtrGet(&shared);
    const base = bs.getData() orelse return null;
    const base_bytes: [*]const u8 = @ptrCast(base);
    return base_bytes[byte_off .. byte_off + byte_len];
}

/// __fs_write_bytes(path, Uint8Array) → bool. Writes the typed array's raw bytes
/// straight to disk (creating parent dirs, truncating). The GL-compliant binary
/// write door: no base64, no UTF-8 re-encoding — the bake hands the loader packed
/// bytes without a text inflate pass (the path that OOM'd the JS heap, req_1586).
fn fsWriteBytes(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path_buf);
    const bytes = argView(info, 1) orelse {
        setBool(info, false);
        return;
    };

    if (std.mem.lastIndexOfScalar(u8, path_buf, '/')) |idx| {
        std.fs.cwd().makePath(path_buf[0..idx]) catch {};
    }
    const file = std.fs.cwd().createFile(path_buf, .{ .truncate = true }) catch {
        setBool(info, false);
        return;
    };
    defer file.close();
    file.writeAll(bytes) catch {
        setBool(info, false);
        return;
    };
    setBool(info, true);
}

fn fsWriteBase64Atomic(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path_buf);
    const b64_buf = argStringAlloc(alloc, info, 1) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(b64_buf);

    const dec = std.base64.standard.Decoder;
    const decoded_len = dec.calcSizeForSlice(b64_buf) catch {
        setBool(info, false);
        return;
    };
    const decoded = alloc.alloc(u8, decoded_len) catch {
        setBool(info, false);
        return;
    };
    defer alloc.free(decoded);
    dec.decode(decoded, b64_buf) catch {
        setBool(info, false);
        return;
    };

    if (std.mem.lastIndexOfScalar(u8, path_buf, '/')) |idx| {
        std.fs.cwd().makePath(path_buf[0..idx]) catch {};
    }
    var tmp_buf: [std.fs.max_path_bytes]u8 = undefined;
    const tmp_path = std.fmt.bufPrint(&tmp_buf, "{s}.tmp.{d}", .{ path_buf, std.time.nanoTimestamp() }) catch {
        setBool(info, false);
        return;
    };
    var file = std.fs.cwd().createFile(tmp_path, .{ .truncate = true }) catch {
        setBool(info, false);
        return;
    };
    file.writeAll(decoded) catch {
        file.close();
        std.fs.cwd().deleteFile(tmp_path) catch {};
        setBool(info, false);
        return;
    };
    file.sync() catch {
        file.close();
        std.fs.cwd().deleteFile(tmp_path) catch {};
        setBool(info, false);
        return;
    };
    file.close();
    std.fs.cwd().rename(tmp_path, path_buf) catch {
        std.fs.cwd().deleteFile(tmp_path) catch {};
        setBool(info, false);
        return;
    };
    setBool(info, true);
}

/// __fs_write_bytes_atomic(path, Uint8Array) → bool. The atomic sibling of
/// __fs_write_bytes (req_1799): writes the raw bytes to a temp file, fsyncs, then
/// renames over `path` — so a write interrupted mid-flight (a kernel panic on this box)
/// corrupts only the temp, never the live file. Raw bytes, no base64 (the bake's 5MB+
/// game-file would balloon the JS heap through a base64 string, req_1586) — use this for
/// the game-file write so a bad bake can't clobber the working one.
fn fsWriteBytesAtomic(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path_buf);
    const bytes = argView(info, 1) orelse {
        setBool(info, false);
        return;
    };

    if (std.mem.lastIndexOfScalar(u8, path_buf, '/')) |idx| {
        std.fs.cwd().makePath(path_buf[0..idx]) catch {};
    }
    var tmp_buf: [std.fs.max_path_bytes]u8 = undefined;
    const tmp_path = std.fmt.bufPrint(&tmp_buf, "{s}.tmp.{d}", .{ path_buf, std.time.nanoTimestamp() }) catch {
        setBool(info, false);
        return;
    };
    var file = std.fs.cwd().createFile(tmp_path, .{ .truncate = true }) catch {
        setBool(info, false);
        return;
    };
    file.writeAll(bytes) catch {
        file.close();
        std.fs.cwd().deleteFile(tmp_path) catch {};
        setBool(info, false);
        return;
    };
    file.sync() catch {
        file.close();
        std.fs.cwd().deleteFile(tmp_path) catch {};
        setBool(info, false);
        return;
    };
    file.close();
    std.fs.cwd().rename(tmp_path, path_buf) catch {
        std.fs.cwd().deleteFile(tmp_path) catch {};
        setBool(info, false);
        return;
    };
    setBool(info, true);
}

fn fsReadRjmpEntities(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path_buf = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(path_buf);

    const data = std.fs.cwd().readFileAlloc(alloc, path_buf, 64 * 1024 * 1024) catch {
        setNull(info);
        return;
    };
    defer alloc.free(data);

    const known = [_]u32{mapfile.LumpType.entities};
    const lumps = mapfile.readLumps(alloc, data, &known) catch {
        setNull(info);
        return;
    };
    defer alloc.free(lumps);
    const entities = mapfile.findLump(lumps, mapfile.LumpType.entities) orelse {
        setNull(info);
        return;
    };
    setString(info, entities.data);
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
        // Recursive: cli's __remove used deleteTree, callers rely on that
        // (e.g., scripts wiping cache dirs). deleteDir would fail on
        // non-empty directories.
        .directory => std.fs.cwd().deleteTree(path_buf) catch {
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

    const data = std.fs.cwd().readFileAlloc(alloc, path_buf, 256 * 1024 * 1024) catch {
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

pub fn registerFs(vm: anytype) void {
    _ = vm;
    v8_runtime.registerHostFn("__fs_read", fsRead);
    v8_runtime.registerHostFn("__fs_read_base64", fsReadBase64);
    v8_runtime.registerHostFn("__fs_read_rjmp_entities", fsReadRjmpEntities);
    v8_runtime.registerHostFn("__fs_write", fsWrite);
    v8_runtime.registerHostFn("__fs_config_dir", fsConfigDir);
    v8_runtime.registerHostFn("__fs_write_bytes", fsWriteBytes);
    v8_runtime.registerHostFn("__fs_write_bytes_atomic", fsWriteBytesAtomic);
    v8_runtime.registerHostFn("__fs_write_base64_atomic", fsWriteBase64Atomic);
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
}
