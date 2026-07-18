//! framework/image/codec.zig — in-memory image transcode pipeline (the
//! Sharp-equivalent core).
//!
//! decode (stb_image) → optional resize (stb_image_resize2) → encode
//! (PNG / JPEG via stb_image_write, WebP via dlopen'd libwebp).
//!
//! THE INVARIANT THAT MAKES THIS WORTH BUILDING: the heavy raw RGBA buffer
//! NEVER crosses the JS↔Zig FFI boundary. A cart hands compressed bytes (or
//! a base64 string) in and gets compressed bytes back. A 4K image moves as
//! ~150KB of WebP, not ~33MB of RGBA — directly solving "30MB of b64".
//!
//! Formats:
//!   decode — PNG, JPEG, BMP, GIF, PSD, HDR, PIC, PNM (stb_image) + WebP (libwebp)
//!   encode — PNG, JPEG (stb_image_write) + WebP (libwebp, lossy + lossless)
//!
//! WebP is dlopen'd lazily on first use (the sqlite3 pattern): PNG/JPEG-only
//! carts never load libwebp; WebP "just works" when libwebp.so.7 is present.

const std = @import("std");

// ── stb_image (decode) — impls in stb/stb_image_impl.c ───────────────────
extern fn stbi_load_from_memory(buffer: [*]const u8, len: c_int, x: *c_int, y: *c_int, channels_in_file: *c_int, desired_channels: c_int) ?[*]u8;
extern fn stbi_info_from_memory(buffer: [*]const u8, len: c_int, x: *c_int, y: *c_int, comp: *c_int) c_int;
extern fn stbi_image_free(retval: ?*anyopaque) void;

// ── stb_image_write (encode) — impls in stb/stb_image_write_impl.c ───────
const StbiWriteFunc = *const fn (context: ?*anyopaque, data: ?*anyopaque, size: c_int) callconv(.c) void;
extern fn stbi_write_png_to_func(func: StbiWriteFunc, context: ?*anyopaque, w: c_int, h: c_int, comp: c_int, data: ?*const anyopaque, stride_in_bytes: c_int) c_int;
extern fn stbi_write_jpg_to_func(func: StbiWriteFunc, context: ?*anyopaque, w: c_int, h: c_int, comp: c_int, data: ?*const anyopaque, quality: c_int) c_int;

// ── stb_image_resize2 — impls in stb/stb_image_resize_impl.c ─────────────
const STBIR_RGBA: c_int = 4; // 4-chan, non-premultiplied alpha
extern fn stbir_resize_uint8_srgb(input_pixels: [*]const u8, in_w: c_int, in_h: c_int, in_stride: c_int, output_pixels: ?[*]u8, out_w: c_int, out_h: c_int, out_stride: c_int, pixel_layout: c_int) ?[*]u8;

// ── libwebp (dlopen'd) ───────────────────────────────────────────────────
extern "c" fn dlopen(filename: ?[*:0]const u8, flags: c_int) ?*anyopaque;
extern "c" fn dlsym(handle: ?*anyopaque, symbol: [*:0]const u8) ?*anyopaque;
const RTLD_NOW: c_int = 2;

const WebpEncodeRGBAFn = *const fn (rgba: [*]const u8, width: c_int, height: c_int, stride: c_int, quality: f32, output: *?[*]u8) callconv(.c) usize;
const WebpEncodeLosslessRGBAFn = *const fn (rgba: [*]const u8, width: c_int, height: c_int, stride: c_int, output: *?[*]u8) callconv(.c) usize;
const WebpDecodeRGBAFn = *const fn (data: [*]const u8, data_size: usize, width: *c_int, height: *c_int) callconv(.c) ?[*]u8;
const WebpGetInfoFn = *const fn (data: [*]const u8, data_size: usize, width: *c_int, height: *c_int) callconv(.c) c_int;
const WebpFreeFn = *const fn (ptr: ?*anyopaque) callconv(.c) void;

const Webp = struct {
    tried: bool = false,
    handle: ?*anyopaque = null,
    encode: ?WebpEncodeRGBAFn = null,
    encode_lossless: ?WebpEncodeLosslessRGBAFn = null,
    decode: ?WebpDecodeRGBAFn = null,
    get_info: ?WebpGetInfoFn = null,
    free: ?WebpFreeFn = null,
};
var g_webp: Webp = .{};

/// Lazily dlopen libwebp + resolve symbols. Returns null when libwebp is
/// unavailable; callers surface error.WebpUnavailable so the JS side can
/// fall back to JPEG. Tried-once: a missing lib never re-probes per call.
fn webp() ?*Webp {
    if (g_webp.tried) return if (g_webp.handle != null) &g_webp else null;
    g_webp.tried = true;
    const names = [_][*:0]const u8{ "libwebp.so.7", "libwebp.so", "libwebp.7.dylib", "libwebp.dylib" };
    var h: ?*anyopaque = null;
    for (names) |n| {
        h = dlopen(n, RTLD_NOW);
        if (h != null) break;
    }
    if (h == null) return null;
    g_webp.handle = h;
    // @alignCast: dlsym returns ?*anyopaque (align 1); on aarch64 a fn pointer
    // has alignment >1, so @ptrCast alone trips "increases pointer alignment".
    // Real function addresses are properly aligned, so the alignCast is sound.
    g_webp.encode = @ptrCast(@alignCast(dlsym(h, "WebPEncodeRGBA")));
    g_webp.encode_lossless = @ptrCast(@alignCast(dlsym(h, "WebPEncodeLosslessRGBA")));
    g_webp.decode = @ptrCast(@alignCast(dlsym(h, "WebPDecodeRGBA")));
    g_webp.get_info = @ptrCast(@alignCast(dlsym(h, "WebPGetInfo")));
    g_webp.free = @ptrCast(@alignCast(dlsym(h, "WebPFree")));
    // All five are required; a partial resolve means a broken/foreign lib.
    if (g_webp.encode == null or g_webp.encode_lossless == null or g_webp.decode == null or g_webp.get_info == null or g_webp.free == null) {
        g_webp.handle = null;
        return null;
    }
    return &g_webp;
}

// ── Public types ─────────────────────────────────────────────────────────

pub const Format = enum {
    png,
    jpeg,
    webp,

    pub fn fromStr(s: []const u8) ?Format {
        if (std.mem.eql(u8, s, "png")) return .png;
        if (std.mem.eql(u8, s, "jpeg") or std.mem.eql(u8, s, "jpg")) return .jpeg;
        if (std.mem.eql(u8, s, "webp")) return .webp;
        return null;
    }

    pub fn label(self: Format) []const u8 {
        return switch (self) {
            .png => "png",
            .jpeg => "jpeg",
            .webp => "webp",
        };
    }
};

/// How a resize fits the target box when BOTH width and height are given.
/// Mirrors sharp's `fit`. With only one dimension given, aspect is always
/// preserved and `fit` is ignored.
pub const Fit = enum {
    fill, // stretch to exactly w×h (ignores aspect)
    inside, // largest size that fits inside w×h, aspect preserved
    outside, // smallest size that covers w×h, aspect preserved

    pub fn fromStr(s: []const u8) Fit {
        if (std.mem.eql(u8, s, "fill")) return .fill;
        if (std.mem.eql(u8, s, "outside")) return .outside;
        return .inside;
    }
};

pub const ResizeSpec = struct {
    width: ?u32 = null,
    height: ?u32 = null,
    fit: Fit = .inside,
    /// When true, never scale UP past the source dimensions (sharp's
    /// withoutEnlargement). The common AI-downscale case wants this off so
    /// `.resize(1024)` still works on a smaller source, but it's here.
    without_enlargement: bool = false,
};

pub const EncodeSpec = struct {
    format: Format,
    quality: u8 = 80, // 1..100, jpeg + lossy webp
    lossless: bool = false, // webp only
};

/// An owned decoded image: tightly-packed RGBA, width*height*4 bytes.
pub const Image = struct {
    pixels: [*]u8,
    width: u32,
    height: u32,
    owner: enum { stbi, zig },
    alloc: std.mem.Allocator,

    pub fn data(self: Image) []u8 {
        return self.pixels[0 .. @as(usize, self.width) * @as(usize, self.height) * 4];
    }

    pub fn deinit(self: Image) void {
        switch (self.owner) {
            .stbi => stbi_image_free(self.pixels),
            .zig => self.alloc.free(self.data()),
        }
    }
};

pub const Info = struct {
    width: u32,
    height: u32,
    channels: u32,
    format: ?Format, // null = decodable by stb but not one we name (bmp/gif/…)
    format_str: []const u8, // always a human label, even for unnamed formats
};

// ── Magic-byte format sniffing ───────────────────────────────────────────

fn sniff(bytes: []const u8) ?Format {
    if (bytes.len >= 8 and std.mem.eql(u8, bytes[0..8], &[_]u8{ 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A })) return .png;
    if (bytes.len >= 3 and bytes[0] == 0xFF and bytes[1] == 0xD8 and bytes[2] == 0xFF) return .jpeg;
    if (bytes.len >= 12 and std.mem.eql(u8, bytes[0..4], "RIFF") and std.mem.eql(u8, bytes[8..12], "WEBP")) return .webp;
    return null;
}

fn sniffLabel(bytes: []const u8) []const u8 {
    if (sniff(bytes)) |f| return f.label();
    if (bytes.len >= 6 and (std.mem.eql(u8, bytes[0..6], "GIF87a") or std.mem.eql(u8, bytes[0..6], "GIF89a"))) return "gif";
    if (bytes.len >= 2 and bytes[0] == 'B' and bytes[1] == 'M') return "bmp";
    return "unknown";
}

// ── Decode ───────────────────────────────────────────────────────────────

/// Decode any supported source to owned RGBA. Picks libwebp for WebP,
/// stb_image for everything else.
pub fn decode(alloc: std.mem.Allocator, bytes: []const u8) !Image {
    if (bytes.len == 0) return error.EmptyInput;

    if (sniff(bytes) == .webp) {
        const w = webp() orelse return error.WebpUnavailable;
        var iw: c_int = 0;
        var ih: c_int = 0;
        const out = w.decode.?(bytes.ptr, bytes.len, &iw, &ih) orelse return error.DecodeFailed;
        defer w.free.?(out);
        if (iw <= 0 or ih <= 0) return error.DecodeFailed;
        // libwebp owns `out` (WebPFree); copy into a Zig-owned buffer so the
        // whole pipeline frees uniformly via the allocator.
        const n = @as(usize, @intCast(iw)) * @as(usize, @intCast(ih)) * 4;
        const buf = try alloc.alloc(u8, n);
        @memcpy(buf, out[0..n]);
        return Image{ .pixels = buf.ptr, .width = @intCast(iw), .height = @intCast(ih), .owner = .zig, .alloc = alloc };
    }

    var iw: c_int = 0;
    var ih: c_int = 0;
    var ch: c_int = 0;
    const px = stbi_load_from_memory(bytes.ptr, @intCast(bytes.len), &iw, &ih, &ch, 4) orelse return error.DecodeFailed;
    if (iw <= 0 or ih <= 0) {
        stbi_image_free(px);
        return error.DecodeFailed;
    }
    return Image{ .pixels = px, .width = @intCast(iw), .height = @intCast(ih), .owner = .stbi, .alloc = alloc };
}

/// Cheap metadata read — dimensions + format without a full pixel decode.
pub fn info(bytes: []const u8) !Info {
    if (bytes.len == 0) return error.EmptyInput;
    const label = sniffLabel(bytes);

    if (sniff(bytes) == .webp) {
        const w = webp() orelse return error.WebpUnavailable;
        var iw: c_int = 0;
        var ih: c_int = 0;
        if (w.get_info.?(bytes.ptr, bytes.len, &iw, &ih) == 0) return error.InfoFailed;
        return Info{ .width = @intCast(iw), .height = @intCast(ih), .channels = 4, .format = .webp, .format_str = "webp" };
    }

    var iw: c_int = 0;
    var ih: c_int = 0;
    var comp: c_int = 0;
    if (stbi_info_from_memory(bytes.ptr, @intCast(bytes.len), &iw, &ih, &comp) == 0) return error.InfoFailed;
    return Info{ .width = @intCast(iw), .height = @intCast(ih), .channels = @intCast(comp), .format = sniff(bytes), .format_str = label };
}

// ── Resize ───────────────────────────────────────────────────────────────

const Dims = struct { w: u32, h: u32 };

/// Resolve the target dimensions from a ResizeSpec against a source size.
pub fn computeDims(sw: u32, sh: u32, rs: ResizeSpec) Dims {
    if (sw == 0 or sh == 0) return .{ .w = sw, .h = sh };

    const tw = rs.width;
    const th = rs.height;
    if (tw == null and th == null) return .{ .w = sw, .h = sh };

    var out: Dims = undefined;
    if (tw != null and th == null) {
        const w = @max(1, tw.?);
        out = .{ .w = w, .h = scaleDim(sh, w, sw) };
    } else if (th != null and tw == null) {
        const h = @max(1, th.?);
        out = .{ .w = scaleDim(sw, h, sh), .h = h };
    } else switch (rs.fit) {
        .fill => out = .{ .w = @max(1, tw.?), .h = @max(1, th.?) },
        .inside, .outside => {
            const sx = @as(f64, tw.?) / sw;
            const sy = @as(f64, th.?) / sh;
            const scale = if (rs.fit == .inside) @min(sx, sy) else @max(sx, sy);
            const scaled_w: u32 = @round(@as(f64, sw) * scale);
            const scaled_h: u32 = @round(@as(f64, sh) * scale);
            out = .{
                .w = @max(1, scaled_w),
                .h = @max(1, scaled_h),
            };
        },
    }

    if (rs.without_enlargement) {
        out.w = @min(out.w, sw);
        out.h = @min(out.h, sh);
    }
    return out;
}

fn scaleDim(src_other: u32, target: u32, src_target: u32) u32 {
    const v = @as(u64, src_other) * @as(u64, target) / @as(u64, src_target);
    return @max(1, @as(u32, @intCast(v)));
}

/// Resize an Image to exact out_w×out_h. Returns a new Zig-owned Image.
pub fn resize(alloc: std.mem.Allocator, src: Image, out_w: u32, out_h: u32) !Image {
    const n = @as(usize, out_w) * @as(usize, out_h) * 4;
    const out = try alloc.alloc(u8, n);
    errdefer alloc.free(out);
    const r = stbir_resize_uint8_srgb(src.pixels, @intCast(src.width), @intCast(src.height), 0, out.ptr, @intCast(out_w), @intCast(out_h), 0, STBIR_RGBA);
    if (r == null) return error.ResizeFailed;
    return Image{ .pixels = out.ptr, .width = out_w, .height = out_h, .owner = .zig, .alloc = alloc };
}

// ── Encode ───────────────────────────────────────────────────────────────

const Sink = struct {
    list: std.ArrayList(u8) = .empty,
    alloc: std.mem.Allocator,
    failed: bool = false,
};

fn sinkWrite(context: ?*anyopaque, data: ?*anyopaque, size: c_int) callconv(.c) void {
    const sink: *Sink = @ptrCast(@alignCast(context.?));
    if (sink.failed or size <= 0 or data == null) return;
    const bytes: [*]const u8 = @ptrCast(data.?);
    sink.list.appendSlice(sink.alloc, bytes[0..@intCast(size)]) catch {
        sink.failed = true;
    };
}

/// Encode an Image to `spec.format`. Returns owned bytes the caller frees.
pub fn encode(alloc: std.mem.Allocator, img: Image, spec: EncodeSpec) ![]u8 {
    return switch (spec.format) {
        .png => encodeStb(alloc, img, .png, 0),
        .jpeg => encodeStb(alloc, img, .jpeg, @intCast(std.math.clamp(@as(i32, spec.quality), 1, 100))),
        .webp => encodeWebp(alloc, img, spec),
    };
}

fn encodeStb(alloc: std.mem.Allocator, img: Image, fmt: enum { png, jpeg }, quality: c_int) ![]u8 {
    var sink = Sink{ .alloc = alloc };
    errdefer sink.list.deinit(alloc);
    const w: c_int = @intCast(img.width);
    const h: c_int = @intCast(img.height);
    const ok = switch (fmt) {
        // PNG keeps RGBA (alpha preserved); JPEG has no alpha — stb uses the
        // leading 3 channels and ignores the 4th.
        .png => stbi_write_png_to_func(sinkWrite, &sink, w, h, 4, img.pixels, w * 4),
        .jpeg => stbi_write_jpg_to_func(sinkWrite, &sink, w, h, 4, img.pixels, quality),
    };
    if (ok == 0 or sink.failed) return error.EncodeFailed;
    return sink.list.toOwnedSlice(alloc);
}

fn encodeWebp(alloc: std.mem.Allocator, img: Image, spec: EncodeSpec) ![]u8 {
    const w = webp() orelse return error.WebpUnavailable;
    const iw: c_int = @intCast(img.width);
    const ih: c_int = @intCast(img.height);
    const stride: c_int = iw * 4;
    var out: ?[*]u8 = null;
    const n = if (spec.lossless)
        w.encode_lossless.?(img.pixels, iw, ih, stride, &out)
    else
        w.encode.?(img.pixels, iw, ih, stride, @floatFromInt(std.math.clamp(@as(i32, spec.quality), 1, 100)), &out);
    if (n == 0 or out == null) {
        if (out) |o| w.free.?(o);
        return error.EncodeFailed;
    }
    defer w.free.?(out.?);
    const buf = try alloc.alloc(u8, n);
    @memcpy(buf, out.?[0..n]);
    return buf;
}

// ── The one-shot pipeline ────────────────────────────────────────────────

/// decode → optional resize → encode, all in-process. `input` is compressed
/// source bytes; the return is compressed output bytes. The RGBA between the
/// stages is allocated and freed here and never escapes.
pub fn transcode(alloc: std.mem.Allocator, input: []const u8, resize_spec: ?ResizeSpec, enc: EncodeSpec) ![]u8 {
    var img = try decode(alloc, input);

    if (resize_spec) |rs| {
        const d = computeDims(img.width, img.height, rs);
        if (d.w != img.width or d.h != img.height) {
            const resized = resize(alloc, img, d.w, d.h) catch |e| {
                img.deinit();
                return e;
            };
            img.deinit();
            img = resized;
        }
    }
    defer img.deinit();
    return encode(alloc, img, enc);
}

/// Whether WebP support is actually available in this process (libwebp
/// resolved). Lets the JS side report capability without a failed encode.
pub fn webpAvailable() bool {
    return webp() != null;
}
