//! framework/v8_bindings_image_ops.zig — the @reactjit/image door
//! (`__imageops_*`). A Sharp-equivalent decode/resize/encode service that
//! keeps the heavy raw RGBA inside Zig — carts pass compressed bytes (or a
//! base64 string) in and get compressed bytes back.
//!
//! Gated INGREDIENT: a cart opts in by importing runtime/image.ts, which
//! flips -Dhas-imageops via the metafile gate. When off, this file is never
//! parsed (codec.zig + stb_image_resize never compile in) and 2D/3D carts
//! pay zero host fns and zero bytes.
//!
//!   __imageops_transcode(input, optsJson) → Uint8Array | null
//!       input: Uint8Array of compressed bytes OR a string (base64, with or
//!       without a `data:image/...;base64,` prefix). optsJson selects format,
//!       quality, lossless, and an optional resize. decode→resize→encode all
//!       happen here; only the small output crosses back.
//!   __imageops_info(input) → JSON string | null
//!       { width, height, channels, format } without a full pixel decode.
//!   __imageops_decode_raw(input) → Uint8Array | null
//!       [w u32 LE][h u32 LE][tight RGBA rows] — for carts that genuinely
//!       need pixels (feed a Canvas/shader/StaticSurface).
//!   __imageops_encode_raw(rgba, w, h, optsJson) → Uint8Array | null
//!       Encode raw RGBA pixels straight to PNG/JPEG/WebP.
//!   __imageops_webp_available() → bool — is libwebp resolvable here.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const host_io = @import("host_io.zig");
const codec = @import("image/codec.zig");
const quantize = @import("image/quantize.zig");

const alloc = std.heap.page_allocator;

// ── arg helpers (mirrors v8_bindings_paintable / _capture) ───────────────

fn argStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (info.length() <= idx) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const len = str.lenUtf8(iso);
    const buf = alloc.alloc(u8, len) catch return null;
    _ = str.writeUtf8(iso, buf);
    return buf;
}

fn argI32(info: v8.FunctionCallbackInfo, idx: u32, default: i32) i32 {
    if (info.length() <= idx) return default;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toI32(ctx) catch default;
}

/// Raw bytes from a Uint8Array / ArrayBufferView arg. Pointer owned by V8 —
/// valid only for the duration of the call (consume synchronously).
fn argView(info: v8.FunctionCallbackInfo, idx: u32) ?[]const u8 {
    if (idx >= info.length()) return null;
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

const Input = struct { bytes: []const u8, owned: bool };

fn freeInput(in: Input) void {
    if (in.owned) alloc.free(@constCast(in.bytes));
}

/// Input arg → compressed source bytes. A typed array is borrowed in place
/// (zero copy); a string is treated as base64 (any `data:...;base64,` prefix
/// stripped) and decoded into an owned buffer.
fn readInput(info: v8.FunctionCallbackInfo, idx: u32) ?Input {
    if (idx >= info.length()) return null;
    if (info.getArg(idx).isArrayBufferView()) {
        const b = argView(info, idx) orelse return null;
        return .{ .bytes = b, .owned = false };
    }
    const s = argStringAlloc(info, idx) orelse return null;
    defer alloc.free(s);
    var payload: []const u8 = s;
    if (std.mem.indexOf(u8, s, "base64,")) |pos| payload = s[pos + 7 ..];
    payload = std.mem.trim(u8, payload, " \t\r\n");

    inline for (.{ std.base64.standard, std.base64.url_safe }) |codecs| {
        const dec = codecs.Decoder;
        if (dec.calcSizeForSlice(payload)) |n| {
            const buf = alloc.alloc(u8, n) catch return null;
            if (dec.decode(buf, payload)) |_| {
                return .{ .bytes = buf, .owned = true };
            } else |_| alloc.free(buf);
        } else |_| {}
    }
    return null;
}

// ── result helpers ───────────────────────────────────────────────────────

fn returnNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(info.getIsolate().initNull());
}

/// Hand `bytes` (OWNED by page_allocator) to JS as a zero-copy Uint8Array;
/// the backing-store deleter frees it on GC. Mirrors v8_bindings_capture.
fn returnBytes(info: v8.FunctionCallbackInfo, bytes: []u8) void {
    const iso = info.getIsolate();
    const Ctx = struct { len: usize };
    const ctx = alloc.create(Ctx) catch {
        alloc.free(bytes);
        returnNull(info);
        return;
    };
    ctx.* = .{ .len = bytes.len };
    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(bytes.ptr),
        bytes.len,
        bytesDeleter,
        @ptrCast(ctx),
    ) orelse {
        alloc.free(bytes);
        alloc.destroy(ctx);
        returnNull(info);
        return;
    };
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    const u8a = v8.Uint8Array.init(ab, 0, bytes.len);
    info.getReturnValue().set(u8a.toValue());
}

fn bytesDeleter(data: ?*anyopaque, _: usize, deleter_data: ?*anyopaque) callconv(.c) void {
    if (data) |raw| {
        const Ctx = struct { len: usize };
        const ctx: *Ctx = @ptrCast(@alignCast(deleter_data.?));
        const p: [*]u8 = @ptrCast(raw);
        alloc.free(p[0..ctx.len]);
        alloc.destroy(ctx);
    }
}

fn returnString(info: v8.FunctionCallbackInfo, s: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, s));
}

// ── opts parsing ─────────────────────────────────────────────────────────

const ResizeOpts = struct {
    width: ?u32 = null,
    height: ?u32 = null,
    fit: []const u8 = "inside",
    withoutEnlargement: bool = false,
};
const EncodeOpts = struct {
    format: []const u8 = "jpeg",
    quality: u8 = 80,
    lossless: bool = false,
    resize: ?ResizeOpts = null,
};

fn parseEncodeOpts(json: []const u8) !std.json.Parsed(EncodeOpts) {
    return std.json.parseFromSlice(EncodeOpts, alloc, json, .{ .ignore_unknown_fields = true });
}

fn toEncodeSpec(o: EncodeOpts) ?codec.EncodeSpec {
    const fmt = codec.Format.fromStr(o.format) orelse return null;
    return .{ .format = fmt, .quality = o.quality, .lossless = o.lossless };
}

fn toResizeSpec(o: EncodeOpts) ?codec.ResizeSpec {
    const r = o.resize orelse return null;
    if (r.width == null and r.height == null) return null;
    return .{
        .width = r.width,
        .height = r.height,
        .fit = codec.Fit.fromStr(r.fit),
        .without_enlargement = r.withoutEnlargement,
    };
}

// ── host fns ─────────────────────────────────────────────────────────────

fn transcode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const in = readInput(info, 0) orelse return returnNull(info);
    defer freeInput(in);
    const opts_json = argStringAlloc(info, 1) orelse return returnNull(info);
    defer alloc.free(opts_json);

    const parsed = parseEncodeOpts(opts_json) catch return returnNull(info);
    defer parsed.deinit();
    const enc = toEncodeSpec(parsed.value) orelse return returnNull(info);
    const rsz = toResizeSpec(parsed.value);

    const out = codec.transcode(alloc, in.bytes, rsz, enc) catch return returnNull(info);
    returnBytes(info, out);
}

fn imageInfo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const in = readInput(info, 0) orelse return returnNull(info);
    defer freeInput(in);

    const meta = codec.info(in.bytes) catch return returnNull(info);
    var buf: [256]u8 = undefined;
    const json = std.fmt.bufPrint(&buf, "{{\"width\":{d},\"height\":{d},\"channels\":{d},\"format\":\"{s}\"}}", .{ meta.width, meta.height, meta.channels, meta.format_str }) catch return returnNull(info);
    returnString(info, json);
}

fn decodeRaw(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const in = readInput(info, 0) orelse return returnNull(info);
    defer freeInput(in);

    var img = codec.decode(alloc, in.bytes) catch return returnNull(info);
    defer img.deinit();
    const px = img.data();
    const out = alloc.alloc(u8, 8 + px.len) catch return returnNull(info);
    std.mem.writeInt(u32, out[0..4], img.width, .little);
    std.mem.writeInt(u32, out[4..8], img.height, .little);
    @memcpy(out[8..], px);
    returnBytes(info, out);
}

fn encodeRaw(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rgba = argView(info, 0) orelse return returnNull(info);
    const w: u32 = @intCast(@max(0, argI32(info, 1, 0)));
    const h: u32 = @intCast(@max(0, argI32(info, 2, 0)));
    const opts_json = argStringAlloc(info, 3) orelse return returnNull(info);
    defer alloc.free(opts_json);
    if (w == 0 or h == 0 or rgba.len < @as(usize, w) * @as(usize, h) * 4) return returnNull(info);

    const parsed = parseEncodeOpts(opts_json) catch return returnNull(info);
    defer parsed.deinit();
    const enc = toEncodeSpec(parsed.value) orelse return returnNull(info);

    // Borrow the JS pixels in place — encode reads, never mutates or holds.
    const img = codec.Image{ .pixels = @constCast(rgba.ptr), .width = w, .height = h, .owner = .zig, .alloc = alloc };
    const out = codec.encode(alloc, img, enc) catch return returnNull(info);
    returnBytes(info, out);
}

fn webpAvailable(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), codec.webpAvailable()));
}

/// __imageops_quantize(input, colors, maxSize) → Uint8Array | null.
/// The pixel-texture import probe: decode, clamp the longest side to maxSize
/// (default 128 — a texture's canvas is one tile), median-cut to `colors`
/// (2..255, default 64), remap. Output layout:
///   [w u32 LE][h u32 LE][k u32 LE][mse f32 LE][palette k*3 RGB][indices w*h]
/// index 0xFF = transparent. mse (mean squared RGB error over opaque pixels)
/// is the "does this image WANT to be a palette texture" signal.
fn quantizeOp(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const in = readInput(info, 0) orelse return returnNull(info);
    defer freeInput(in);
    const colors: u32 = @intCast(std.math.clamp(argI32(info, 1, 64), 2, 255));
    const max_size: u32 = @intCast(std.math.clamp(argI32(info, 2, 128), 8, 512));

    var img = codec.decode(alloc, in.bytes) catch return returnNull(info);
    defer img.deinit();

    // Clamp the longest side, preserving aspect (never upscale).
    var src = img;
    var scaled: ?codec.Image = null;
    defer if (scaled) |s| s.deinit();
    const longest = @max(img.width, img.height);
    if (longest > max_size) {
        const ow = @max(1, img.width * max_size / longest);
        const oh = @max(1, img.height * max_size / longest);
        scaled = codec.resize(alloc, img, ow, oh) catch return returnNull(info);
        src = scaled.?;
    }

    const q = quantize.quantize(alloc, src.data(), src.width, src.height, colors) catch return returnNull(info);
    defer q.deinit(alloc);

    const count: usize = @as(usize, src.width) * @as(usize, src.height);
    const out = alloc.alloc(u8, 16 + q.palette.len * 3 + count) catch return returnNull(info);
    std.mem.writeInt(u32, out[0..4], src.width, .little);
    std.mem.writeInt(u32, out[4..8], src.height, .little);
    std.mem.writeInt(u32, out[8..12], @intCast(q.palette.len), .little);
    std.mem.writeInt(u32, out[12..16], @bitCast(q.mse), .little);
    for (q.palette, 0..) |pc, i| {
        out[16 + i * 3] = pc[0];
        out[16 + i * 3 + 1] = pc[1];
        out[16 + i * 3 + 2] = pc[2];
    }
    @memcpy(out[16 + q.palette.len * 3 ..], q.indices);
    returnBytes(info, out);
}

/// __imageops_write_file(path, bytes) → bool. Keeps toFile() inside this gate
/// so a cart using @reactjit/image doesn't have to also pull @reactjit fs.
fn writeFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = blk: {
        const path = argStringAlloc(info, 0) orelse break :blk false;
        defer alloc.free(path);
        const bytes = argView(info, 1) orelse break :blk false;
        const f = std.Io.Dir.cwd().createFile(host_io.io(), path, .{ .truncate = true }) catch break :blk false;
        defer f.close(host_io.io());
        f.writeStreamingAll(host_io.io(), bytes) catch break :blk false;
        break :blk true;
    };
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), ok));
}

pub fn registerImageOps(_: anytype) void {
    v8_runtime.registerHostFn("__imageops_transcode", transcode);
    v8_runtime.registerHostFn("__imageops_info", imageInfo);
    v8_runtime.registerHostFn("__imageops_decode_raw", decodeRaw);
    v8_runtime.registerHostFn("__imageops_encode_raw", encodeRaw);
    v8_runtime.registerHostFn("__imageops_webp_available", webpAvailable);
    v8_runtime.registerHostFn("__imageops_write_file", writeFile);
    v8_runtime.registerHostFn("__imageops_quantize", quantizeOp);
}
