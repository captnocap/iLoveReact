//! decal_raster.zig — rasterize a packed DECAL RECIPE to RGBA, once, at load
//! (DECALRECIPE-0610).
//!
//! GUIDING_LIGHT: a decal travels as its RECIPE — the packed DecalDoc the
//! bake lowers (cart/hmsc-int/compile/decalPack.ts, the byte-layout twin of
//! the reader here) — never as baked pixels. This module is the host running
//! that recipe ONCE into a CPU RGBA buffer the caller uploads via
//! material_tex.materializePixels — the exact shape shader materials already
//! use (recipe → materialize-at-load). Fixed systems only: rounded-rect SDF
//! fills and FreeType glyphs; the doc is declarative data flowing through
//! them. No GPU needed (pure CPU), so it runs before/without a frame.
//!
//! BINARY LAYOUT (little-endian; colors are 4 raw bytes R,G,B,A):
//!   u16 docW | u16 docH | bg RGBA | u16 nodeCount
//!   per node:
//!     u8 kind (0 rect | 1 text | 2 image)
//!     f32 x | f32 y | f32 w | f32 h | f32 opacity
//!     rect:  fill RGBA | f32 borderRadius | f32 borderWidth | border RGBA
//!     text:  color RGBA | f32 fontSize | u16 fontWeight | u8 align
//!            | f32 letterSpacing | u16 textByteLen | utf8 bytes
//!     image: u32 assetKey | f32 borderRadius | u16 srcByteLen | utf8 bytes
//!            (DECALIMG-0610: assetKey references a content-addressed image
//!            payload — constructor.zig reads manifest kind-11 assets from
//!            the store and hands them in via `images`; stbi decodes here.
//!            Key 0 or a missing payload = warn + skip, never a failure.
//!            The src string is diagnostics only.)
//!
//! Malformed input degrades to null (the face keeps its flat fallback color);
//! it never crashes the construct and never returns partial pixels.

const std = @import("std");
const log = @import("../diag/log.zig");
const c = @import("../c.zig").imports;
const TextEngine = @import("../primitive/text.zig").TextEngine;

const NODE_RECT = 0;
const NODE_TEXT = 1;
const NODE_IMAGE = 2;
// PARAMETRIC neon (req_0893): a glowing stroke path — the compiled twin of
// decalRender.NeonPathView. The byte layout adds (after the shared x/y/w/h/op):
//   stroke RGBA | f32 strokeWidth | glow RGBA | f32 glowWidth | f32 glowOpacity
//   | fill RGBA | u16 dByteLen | utf8 `d` bytes
// Glow defaults are resolved at pack time (decalPack), so this side just strokes.
const NODE_PATH = 3;
/// Curve flattening + segment cap — bounded so a hostile `d` can't stall load.
const PATH_CUBIC_STEPS = 16;
const PATH_QUAD_STEPS = 12;
const MAX_PATH_SEGS = 16384;
/// Longest neon `d` string accepted — mirrors decal.ts MAX_PATH_D_CHARS so the
/// two sides agree on what's a logo vs a hostile blob.
const MAX_PATH_D_BYTES = 20000;

const MIN_DOC_SIDE = 8;
const MAX_DOC_SIDE = 4096;
const MAX_NODES = 256;
const MAX_TEXT_BYTES = 4096;
/// Longest rasterized side — bounds the transient buffer (a 4096² doc would
/// be 64MB); the texture stretches onto its face anyway. 512-1024 reads
/// crisp at game scale (shader materials materialize at 256).
const RASTER_MAX_SIDE: f32 = 1024;
/// Longest decoded image side the blit accepts — the raster canvas caps at
/// 1024 anyway, so a larger decode is a corrupt or hostile payload, not a
/// texture (the bake also caps the file at 8MB).
const MAX_IMAGE_SIDE: c_int = 4096;

pub const Raster = struct {
    rgba: []u8,
    w: u32,
    h: u32,
};

/// One content-addressed image payload (raw encoded file bytes) an image
/// node may reference by manifest key. The caller (world_loader.zig) maps
/// these from constructor.Scene.decal_assets — this module stays free of
/// world/ imports.
pub const ImageAsset = struct {
    key: u32,
    bytes: []const u8,
};

fn findImage(images: []const ImageAsset, key: u32) ?[]const u8 {
    for (images) |asset| {
        if (asset.key == key) return asset.bytes;
    }
    return null;
}

// ── the packed-doc reader (bounds-checked; null on any malformation) ────────

const Reader = struct {
    bytes: []const u8,
    at: usize = 0,

    fn u8v(self: *Reader) ?u8 {
        if (self.at + 1 > self.bytes.len) return null;
        const v = self.bytes[self.at];
        self.at += 1;
        return v;
    }
    fn u16v(self: *Reader) ?u16 {
        if (self.at + 2 > self.bytes.len) return null;
        const v = std.mem.readInt(u16, self.bytes[self.at..][0..2], .little);
        self.at += 2;
        return v;
    }
    fn u32v(self: *Reader) ?u32 {
        if (self.at + 4 > self.bytes.len) return null;
        const v = std.mem.readInt(u32, self.bytes[self.at..][0..4], .little);
        self.at += 4;
        return v;
    }
    fn f32v(self: *Reader) ?f32 {
        if (self.at + 4 > self.bytes.len) return null;
        const v: f32 = @bitCast(std.mem.readInt(u32, self.bytes[self.at..][0..4], .little));
        self.at += 4;
        if (!std.math.isFinite(v)) return null;
        return v;
    }
    fn rgba(self: *Reader) ?[4]u8 {
        if (self.at + 4 > self.bytes.len) return null;
        const v = [4]u8{ self.bytes[self.at], self.bytes[self.at + 1], self.bytes[self.at + 2], self.bytes[self.at + 3] };
        self.at += 4;
        return v;
    }
    fn slice(self: *Reader, len: usize) ?[]const u8 {
        if (self.at + len > self.bytes.len) return null;
        const v = self.bytes[self.at .. self.at + len];
        self.at += len;
        return v;
    }
};

// ── lazy FreeType (the loader never boots the engine's text init) ───────────

var g_font: ?TextEngine = null;
var g_font_tried = false;

/// The same face-path chain framework/engine.zig boots with — duplicated here
/// because the no-V8 loader calls gpu.init directly and never runs engine
/// init. Lives for the process (like materialized shader textures).
fn ensureFont() ?*TextEngine {
    if (g_font != null) return &g_font.?;
    if (g_font_tried) return null;
    g_font_tried = true;
    g_font = TextEngine.initHeadless("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") catch
        TextEngine.initHeadless("/usr/share/fonts/dejavu/DejaVuSans.ttf") catch
        TextEngine.initHeadless("/System/Library/Fonts/Supplemental/Arial.ttf") catch
        TextEngine.initHeadless("C:/Windows/Fonts/segoeui.ttf") catch {
        // warn-level: emitFromLog routes warns to stderr ALWAYS — the no-V8
        // loader has no bus console, and log.print's .info is bus-only there.
        log.warn(.render, "[decal-raster] no system font found — text nodes skipped", .{});
        return null;
    };
    return &g_font.?;
}

// ── compositing ─────────────────────────────────────────────────────────────

/// src-over one pixel: color (r,g,b,a 0-255) at `coverage` (0-1) onto out[i..].
fn blend(out: []u8, i: usize, color: [4]u8, coverage: f32) void {
    const a = (@as(f32, color[3]) / 255.0) * std.math.clamp(coverage, 0, 1);
    if (a <= 0) return;
    const inv = 1 - a;
    const dr: f32 = out[i + 0];
    const dg: f32 = out[i + 1];
    const db: f32 = out[i + 2];
    const da = @as(f32, out[i + 3]) / 255.0;
    out[i + 0] = @trunc(std.math.clamp(color[0] * a + dr * inv, 0, 255));
    out[i + 1] = @trunc(std.math.clamp(color[1] * a + dg * inv, 0, 255));
    out[i + 2] = @trunc(std.math.clamp(color[2] * a + db * inv, 0, 255));
    out[i + 3] = @trunc(std.math.clamp((a + da * inv) * 255.0, 0, 255));
}

/// Signed distance from point (px,py) to a rounded rect centered at
/// (cx,cy) with half extents (hx,hy) and corner radius r. Negative inside.
fn roundedBoxSdf(px: f32, py: f32, cx: f32, cy: f32, hx: f32, hy: f32, r: f32) f32 {
    const rr = std.math.clamp(r, 0, @min(hx, hy));
    const qx = @abs(px - cx) - (hx - rr);
    const qy = @abs(py - cy) - (hy - rr);
    const ox = @max(qx, 0);
    const oy = @max(qy, 0);
    return @sqrt(ox * ox + oy * oy) + @min(@max(qx, qy), 0) - rr;
}

fn fillRect(out: []u8, ow: u32, oh: u32, x: f32, y: f32, w: f32, h: f32, fill: [4]u8, radius: f32, border_w: f32, border: [4]u8, opacity: f32) void {
    if (w <= 0 or h <= 0) return;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const hx = w / 2;
    const hy = h / 2;
    const x0: i64 = @floor(x - 1);
    const y0: i64 = @floor(y - 1);
    const x1: i64 = @ceil(x + w + 1);
    const y1: i64 = @ceil(y + h + 1);
    var fill_c = fill;
    fill_c[3] = @trunc(fill[3] * std.math.clamp(opacity, 0, 1));
    var border_c = border;
    border_c[3] = @trunc(border[3] * std.math.clamp(opacity, 0, 1));
    const has_border = border_w > 0 and border_c[3] > 0;

    var yy = @max(y0, 0);
    while (yy < @min(y1, @as(i64, @intCast(oh)))) : (yy += 1) {
        var xx = @max(x0, 0);
        while (xx < @min(x1, @as(i64, @intCast(ow)))) : (xx += 1) {
            const px = @as(f32, @floatFromInt(xx)) + 0.5;
            const py = @as(f32, @floatFromInt(yy)) + 0.5;
            const dist = roundedBoxSdf(px, py, cx, cy, hx, hy, radius);
            const i: usize = (@as(usize, @intCast(yy)) * @as(usize, @intCast(ow)) + @as(usize, @intCast(xx))) * 4;
            if (has_border) {
                // interior fill ends where the border ring begins
                blend(out, i, fill_c, 0.5 - (dist + border_w));
                // the ring: inside the outer edge AND outside the inner edge
                const ring = @min(0.5 - dist, (dist + border_w) + 0.5);
                blend(out, i, border_c, ring);
            } else {
                blend(out, i, fill_c, 0.5 - dist);
            }
        }
    }
}

// ── text ────────────────────────────────────────────────────────────────────

fn faceFor(font: *TextEngine, weight: u16) c.FT_Face {
    if (weight >= 600 and font.face_bold != null) return font.face_bold;
    return font.face;
}

fn drawTextNode(out: []u8, ow: u32, oh: u32, x: f32, y: f32, w: f32, h: f32, color_in: [4]u8, font_px: u16, weight: u16, align_b: u8, letter_spacing: f32, text: []const u8, opacity: f32) void {
    const font = ensureFont() orelse return;
    const face = faceFor(font, weight);
    if (face == null) return;
    if (c.FT_Set_Pixel_Sizes(face, 0, font_px) != 0) return;

    var color = color_in;
    color[3] = @trunc(color_in[3] * std.math.clamp(opacity, 0, 1));

    const view = std.unicode.Utf8View.init(text) catch return;

    // Pass 1: line width (26.6 advances + letter spacing between glyphs).
    var line_w: f32 = 0;
    var glyphs: usize = 0;
    var it = view.iterator();
    while (it.nextCodepoint()) |cp| {
        if (c.FT_Load_Char(face, cp, c.FT_LOAD_DEFAULT) != 0) continue;
        line_w += @as(f32, @floatFromInt(face.*.glyph.*.advance.x)) / 64.0;
        glyphs += 1;
    }
    if (glyphs == 0) return;
    line_w += letter_spacing * @as(f32, @floatFromInt(glyphs - 1));

    // Pen start: horizontal by align within the node box; baseline centers
    // the face's ascender/descender ink span on the box's vertical middle
    // (mirrors DecalSurface's justifyContent:center single-line layout).
    var pen_x: f32 = switch (align_b) {
        1 => x + (w - line_w) / 2,
        2 => x + w - line_w,
        else => x,
    };
    const metrics = face.*.size.*.metrics;
    const asc = @as(f32, @floatFromInt(metrics.ascender)) / 64.0;
    const desc = @as(f32, @floatFromInt(metrics.descender)) / 64.0; // negative
    const baseline = y + h / 2 + (asc + desc) / 2;

    var it2 = view.iterator();
    while (it2.nextCodepoint()) |cp| {
        if (c.FT_Load_Char(face, cp, c.FT_LOAD_RENDER) != 0) continue;
        const glyph = face.*.glyph;
        const bitmap = glyph.*.bitmap;
        if (bitmap.buffer != null and bitmap.pixel_mode == c.FT_PIXEL_MODE_GRAY and bitmap.pitch > 0) {
            const bw: u32 = @intCast(bitmap.width);
            const bh: u32 = @intCast(bitmap.rows);
            const pitch: usize = @intCast(bitmap.pitch);
            const gx0: i64 = @as(i64, @floor(pen_x)) + @as(i64, glyph.*.bitmap_left);
            const gy0: i64 = @as(i64, @floor(baseline)) - @as(i64, glyph.*.bitmap_top);
            var row: u32 = 0;
            while (row < bh) : (row += 1) {
                const oy = gy0 + row;
                if (oy < 0 or oy >= oh) continue;
                var col: u32 = 0;
                while (col < bw) : (col += 1) {
                    const ox = gx0 + col;
                    if (ox < 0 or ox >= ow) continue;
                    const cov = bitmap.buffer[row * pitch + col];
                    if (cov == 0) continue;
                    const i: usize = (@as(usize, @intCast(oy)) * @as(usize, ow) + @as(usize, @intCast(ox))) * 4;
                    blend(out, i, color, @as(f32, cov) / 255.0);
                }
            }
        }
        pen_x += @as(f32, @floatFromInt(glyph.*.advance.x)) / 64.0 + letter_spacing;
    }
}

// ── images (DECALIMG-0610) ──────────────────────────────────────────────────

/// stbi-decode a content-addressed image payload and blit it into the node's
/// rect: bilinear-sampled, edge-AA'd with the same rounded-rect SDF the rect
/// fill uses (borderRadius rides free). A payload that fails to decode warns
/// and leaves the canvas untouched — image problems never fail the raster.
fn drawImageNode(out: []u8, ow: u32, oh: u32, x: f32, y: f32, w: f32, h: f32, radius: f32, opacity: f32, payload: []const u8, src: []const u8) void {
    if (w <= 0 or h <= 0) return;
    var iw: c_int = 0;
    var ih: c_int = 0;
    var channels: c_int = 0;
    const pixels_ptr = c.stbi_load_from_memory(payload.ptr, @intCast(payload.len), &iw, &ih, &channels, 4);
    if (pixels_ptr == null or iw <= 0 or ih <= 0) {
        log.warn(.render, "[decal-raster] image node ('{s}'): payload does not decode — skipped", .{src});
        return;
    }
    defer c.stbi_image_free(pixels_ptr);
    if (iw > MAX_IMAGE_SIDE or ih > MAX_IMAGE_SIDE) {
        log.warn(.render, "[decal-raster] image node ('{s}'): {d}x{d} exceeds the {d}px side cap — skipped", .{ src, iw, ih, MAX_IMAGE_SIDE });
        return;
    }
    const sw: usize = @intCast(iw);
    const sh: usize = @intCast(ih);
    const pix: [*]const u8 = pixels_ptr;

    const cx = x + w / 2;
    const cy = y + h / 2;
    const hx = w / 2;
    const hy = h / 2;
    const x0: i64 = @floor(x - 1);
    const y0: i64 = @floor(y - 1);
    const x1: i64 = @ceil(x + w + 1);
    const y1: i64 = @ceil(y + h + 1);
    const op = std.math.clamp(opacity, 0, 1);

    var yy = @max(y0, 0);
    while (yy < @min(y1, @as(i64, @intCast(oh)))) : (yy += 1) {
        var xx = @max(x0, 0);
        while (xx < @min(x1, @as(i64, @intCast(ow)))) : (xx += 1) {
            const px = @as(f32, @floatFromInt(xx)) + 0.5;
            const py = @as(f32, @floatFromInt(yy)) + 0.5;
            const coverage = 0.5 - roundedBoxSdf(px, py, cx, cy, hx, hy, radius);
            if (coverage <= 0) continue;
            // Bilinear sample at the rect-relative uv (stb rows are top-down,
            // same orientation as the doc's y axis and the raster output —
            // the face UVs sample top-down content upright, UVFLIP-0610).
            const u = std.math.clamp((px - x) / w, 0, 1);
            const v = std.math.clamp((py - y) / h, 0, 1);
            const fx = u * @as(f32, @floatFromInt(sw - 1));
            const fy = v * @as(f32, @floatFromInt(sh - 1));
            const ix0: usize = @floor(fx);
            const iy0: usize = @floor(fy);
            const ix1 = @min(ix0 + 1, sw - 1);
            const iy1 = @min(iy0 + 1, sh - 1);
            const tx = fx - @floor(fx);
            const ty = fy - @floor(fy);
            var sample: [4]f32 = undefined;
            inline for (0..4) |k| {
                const p00: f32 = pix[(iy0 * sw + ix0) * 4 + k];
                const p10: f32 = pix[(iy0 * sw + ix1) * 4 + k];
                const p01: f32 = pix[(iy1 * sw + ix0) * 4 + k];
                const p11: f32 = pix[(iy1 * sw + ix1) * 4 + k];
                sample[k] = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
            }
            const color = [4]u8{
                @trunc(std.math.clamp(sample[0], 0, 255)),
                @trunc(std.math.clamp(sample[1], 0, 255)),
                @trunc(std.math.clamp(sample[2], 0, 255)),
                @trunc(std.math.clamp(sample[3] * op, 0, 255)),
            };
            const i: usize = (@as(usize, @intCast(yy)) * @as(usize, ow) + @as(usize, @intCast(xx))) * 4;
            blend(out, i, color, coverage);
        }
    }
}

/// MISSING-TEXTURE sentinel (req_1471): a Half-Life-style magenta/black checker
/// drawn into an image node whose asset didn't ship (deleted source, key 0, or no
/// installed payload). A missing texture must SHOUT, not vanish — an invisible
/// wall reads as "fine" when it's actually broken. Opaque so it can't be missed.
fn drawMissingChecker(out: []u8, ow: u32, oh: u32, x: f32, y: f32, w: f32, h: f32, opacity: f32) void {
    if (w <= 0 or h <= 0) return;
    // 8 checks across the node's shorter side — big squares that read as "missing"
    // at any wall size, like the classic dev-texture grid.
    const cell = @max(1.0, @min(w, h) / 8.0);
    const magenta = [4]u8{ 255, 0, 220, 255 };
    const black = [4]u8{ 0, 0, 0, 255 };
    const op = std.math.clamp(opacity, 0, 1);
    const x0: i64 = @floor(x);
    const y0: i64 = @floor(y);
    const x1: i64 = @ceil(x + w);
    const y1: i64 = @ceil(y + h);
    var yy = @max(y0, 0);
    while (yy < @min(y1, @as(i64, @intCast(oh)))) : (yy += 1) {
        var xx = @max(x0, 0);
        while (xx < @min(x1, @as(i64, @intCast(ow)))) : (xx += 1) {
            const cxi: i64 = @floor((@as(f32, @floatFromInt(xx)) - x) / cell);
            const cyi: i64 = @floor((@as(f32, @floatFromInt(yy)) - y) / cell);
            const checker = @mod(cxi + cyi, 2) == 0;
            var color = if (checker) magenta else black;
            color[3] = @trunc(std.math.clamp(color[3] * op, 0, 255));
            const i: usize = (@as(usize, @intCast(yy)) * @as(usize, ow) + @as(usize, @intCast(xx))) * 4;
            blend(out, i, color, 1.0);
        }
    }
}

// ── neon path (PARAMETRIC neon, req_0893) ───────────────────────────────────
// Parse the SVG `d` to flat segments (curves flattened), then stroke them in
// layered passes — wide soft glow under a bright core, the white-hot center on
// top — the exact look decalRender.NeonPathView layers with Graph.Path. Stroke
// work is line geometry, never a fragment shader ([[feedback_shader_vs_polyline]]).

const Seg = struct { ax: f32, ay: f32, bx: f32, by: f32 };

fn withGlowAlpha(col: [4]u8, a: f32) [4]u8 {
    var o = col;
    o[3] = @trunc(std.math.clamp(col[3] * std.math.clamp(a, 0, 1), 0, 255));
    return o;
}

/// One round-capped segment (capsule) blended over its bbox. Overlapping joints
/// over-blend slightly — which reads as a brighter neon joint, the look we want.
fn strokeSeg(out: []u8, ow: u32, oh: u32, ax: f32, ay: f32, bx: f32, by: f32, half: f32, color: [4]u8) void {
    if (half <= 0 or color[3] == 0) return;
    const x0: i64 = @floor(@min(ax, bx) - half - 1);
    const y0: i64 = @floor(@min(ay, by) - half - 1);
    const x1: i64 = @ceil(@max(ax, bx) + half + 1);
    const y1: i64 = @ceil(@max(ay, by) + half + 1);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    var yy = @max(y0, 0);
    while (yy < @min(y1, @as(i64, @intCast(oh)))) : (yy += 1) {
        var xx = @max(x0, 0);
        while (xx < @min(x1, @as(i64, @intCast(ow)))) : (xx += 1) {
            const px = @as(f32, @floatFromInt(xx)) + 0.5;
            const py = @as(f32, @floatFromInt(yy)) + 0.5;
            var t: f32 = 0;
            if (len2 > 1e-6) t = std.math.clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
            const ddx = px - (ax + t * dx);
            const ddy = py - (ay + t * dy);
            const dist = @sqrt(ddx * ddx + ddy * ddy);
            const coverage = 0.5 - (dist - half);
            if (coverage <= 0) continue;
            const i: usize = (@as(usize, @intCast(yy)) * @as(usize, ow) + @as(usize, @intCast(xx))) * 4;
            blend(out, i, color, coverage);
        }
    }
}

const PathScan = struct {
    d: []const u8,
    at: usize = 0,

    fn skipSep(self: *PathScan) void {
        while (self.at < self.d.len) {
            const ch = self.d[self.at];
            if (ch == ' ' or ch == ',' or ch == '\t' or ch == '\n' or ch == '\r') self.at += 1 else break;
        }
    }
    fn peekCmd(self: *PathScan) ?u8 {
        self.skipSep();
        if (self.at >= self.d.len) return null;
        const ch = self.d[self.at];
        if ((ch >= 'a' and ch <= 'z') or (ch >= 'A' and ch <= 'Z')) return ch;
        return null;
    }
    fn num(self: *PathScan) ?f32 {
        self.skipSep();
        const start = self.at;
        var i = self.at;
        if (i < self.d.len and (self.d[i] == '+' or self.d[i] == '-')) i += 1;
        var seen = false;
        while (i < self.d.len and self.d[i] >= '0' and self.d[i] <= '9') : (i += 1) seen = true;
        if (i < self.d.len and self.d[i] == '.') {
            i += 1;
            while (i < self.d.len and self.d[i] >= '0' and self.d[i] <= '9') : (i += 1) seen = true;
        }
        if (seen and i < self.d.len and (self.d[i] == 'e' or self.d[i] == 'E')) {
            i += 1;
            if (i < self.d.len and (self.d[i] == '+' or self.d[i] == '-')) i += 1;
            while (i < self.d.len and self.d[i] >= '0' and self.d[i] <= '9') i += 1;
        }
        if (!seen) return null;
        const v = std.fmt.parseFloat(f32, self.d[start..i]) catch return null;
        self.at = i;
        return if (std.math.isFinite(v)) v else null;
    }
};

fn pushSeg(segs: *std.ArrayList(Seg), allocator: std.mem.Allocator, s: f32, ax: f32, ay: f32, bx: f32, by: f32) void {
    if (segs.items.len >= MAX_PATH_SEGS) return;
    segs.append(allocator, .{ .ax = ax * s, .ay = ay * s, .bx = bx * s, .by = by * s }) catch {};
}

fn flattenCubic(segs: *std.ArrayList(Seg), allocator: std.mem.Allocator, s: f32, x0: f32, y0: f32, x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32) void {
    var prevx = x0;
    var prevy = y0;
    var i: usize = 1;
    while (i <= PATH_CUBIC_STEPS) : (i += 1) {
        const t = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(PATH_CUBIC_STEPS));
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const cc = 3 * u * t * t;
        const dd = t * t * t;
        const cxp = a * x0 + b * x1 + cc * x2 + dd * x3;
        const cyp = a * y0 + b * y1 + cc * y2 + dd * y3;
        pushSeg(segs, allocator, s, prevx, prevy, cxp, cyp);
        prevx = cxp;
        prevy = cyp;
    }
}

fn flattenQuad(segs: *std.ArrayList(Seg), allocator: std.mem.Allocator, s: f32, x0: f32, y0: f32, x1: f32, y1: f32, x2: f32, y2: f32) void {
    var prevx = x0;
    var prevy = y0;
    var i: usize = 1;
    while (i <= PATH_QUAD_STEPS) : (i += 1) {
        const t = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(PATH_QUAD_STEPS));
        const u = 1 - t;
        const cxp = u * u * x0 + 2 * u * t * x1 + t * t * x2;
        const cyp = u * u * y0 + 2 * u * t * y1 + t * t * y2;
        pushSeg(segs, allocator, s, prevx, prevy, cxp, cyp);
        prevx = cxp;
        prevy = cyp;
    }
}

/// Parse `d` into flat segments (in raster pixels via `s`). Supports M/L/H/V/C/
/// Q/Z (abs+rel). S/T approximate the smooth control as the current point (no
/// reflection — neon glow blurs the small difference); A degrades to a line to
/// its endpoint. Coords stay in DOC space; pushSeg scales on append.
fn parsePath(segs: *std.ArrayList(Seg), allocator: std.mem.Allocator, d: []const u8, s: f32) void {
    var ps = PathScan{ .d = d };
    var cx: f32 = 0;
    var cy: f32 = 0;
    var startx: f32 = 0;
    var starty: f32 = 0;
    var cmd: u8 = 0;
    while (segs.items.len < MAX_PATH_SEGS) {
        if (ps.peekCmd()) |cmd_ch| {
            cmd = cmd_ch;
            ps.at += 1;
        } else if (cmd == 0) break;
        const rel = cmd >= 'a' and cmd <= 'z';
        const lower = if (rel) cmd else cmd | 0x20;
        switch (lower) {
            'm' => {
                const x = ps.num() orelse break;
                const y = ps.num() orelse break;
                cx = if (rel) cx + x else x;
                cy = if (rel) cy + y else y;
                startx = cx;
                starty = cy;
                cmd = if (rel) 'l' else 'L'; // implicit lineto for following pairs
            },
            'l' => {
                const x = ps.num() orelse break;
                const y = ps.num() orelse break;
                const nx = if (rel) cx + x else x;
                const ny = if (rel) cy + y else y;
                pushSeg(segs, allocator, s, cx, cy, nx, ny);
                cx = nx;
                cy = ny;
            },
            'h' => {
                const x = ps.num() orelse break;
                const nx = if (rel) cx + x else x;
                pushSeg(segs, allocator, s, cx, cy, nx, cy);
                cx = nx;
            },
            'v' => {
                const y = ps.num() orelse break;
                const ny = if (rel) cy + y else y;
                pushSeg(segs, allocator, s, cx, cy, cx, ny);
                cy = ny;
            },
            'c' => {
                const x1 = ps.num() orelse break;
                const y1 = ps.num() orelse break;
                const x2 = ps.num() orelse break;
                const y2 = ps.num() orelse break;
                const x = ps.num() orelse break;
                const y = ps.num() orelse break;
                const p1x = if (rel) cx + x1 else x1;
                const p1y = if (rel) cy + y1 else y1;
                const p2x = if (rel) cx + x2 else x2;
                const p2y = if (rel) cy + y2 else y2;
                const px = if (rel) cx + x else x;
                const py = if (rel) cy + y else y;
                flattenCubic(segs, allocator, s, cx, cy, p1x, p1y, p2x, p2y, px, py);
                cx = px;
                cy = py;
            },
            's' => {
                const x2 = ps.num() orelse break;
                const y2 = ps.num() orelse break;
                const x = ps.num() orelse break;
                const y = ps.num() orelse break;
                const p2x = if (rel) cx + x2 else x2;
                const p2y = if (rel) cy + y2 else y2;
                const px = if (rel) cx + x else x;
                const py = if (rel) cy + y else y;
                flattenCubic(segs, allocator, s, cx, cy, cx, cy, p2x, p2y, px, py);
                cx = px;
                cy = py;
            },
            'q' => {
                const x1 = ps.num() orelse break;
                const y1 = ps.num() orelse break;
                const x = ps.num() orelse break;
                const y = ps.num() orelse break;
                const p1x = if (rel) cx + x1 else x1;
                const p1y = if (rel) cy + y1 else y1;
                const px = if (rel) cx + x else x;
                const py = if (rel) cy + y else y;
                flattenQuad(segs, allocator, s, cx, cy, p1x, p1y, px, py);
                cx = px;
                cy = py;
            },
            't' => {
                const x = ps.num() orelse break;
                const y = ps.num() orelse break;
                const px = if (rel) cx + x else x;
                const py = if (rel) cy + y else y;
                flattenQuad(segs, allocator, s, cx, cy, cx, cy, px, py);
                cx = px;
                cy = py;
            },
            'a' => {
                // arc → line to endpoint (rx ry rot large sweep x y); flags read
                // as numbers. A faithful arc flattener is the marked follow-up.
                _ = ps.num() orelse break; // rx
                _ = ps.num() orelse break; // ry
                _ = ps.num() orelse break; // x-rotation
                _ = ps.num() orelse break; // large-arc
                _ = ps.num() orelse break; // sweep
                const x = ps.num() orelse break;
                const y = ps.num() orelse break;
                const nx = if (rel) cx + x else x;
                const ny = if (rel) cy + y else y;
                pushSeg(segs, allocator, s, cx, cy, nx, ny);
                cx = nx;
                cy = ny;
            },
            'z' => {
                pushSeg(segs, allocator, s, cx, cy, startx, starty);
                cx = startx;
                cy = starty;
            },
            else => break, // unknown command → stop (what parsed still draws)
        }
    }
}

fn drawNeonPath(
    allocator: std.mem.Allocator,
    out: []u8,
    ow: u32,
    oh: u32,
    s: f32,
    opacity: f32,
    stroke: [4]u8,
    stroke_w: f32,
    glow: [4]u8,
    glow_w: f32,
    glow_a: f32,
    d: []const u8,
) void {
    var segs: std.ArrayList(Seg) = .empty;
    defer segs.deinit(allocator);
    parsePath(&segs, allocator, d, s);
    if (segs.items.len == 0) return;
    const op = std.math.clamp(opacity, 0, 1);
    const ga = std.math.clamp(glow_a, 0, 1) * op;
    // widths are full stroke widths (NeonPathView): capsule half = width/2 × s.
    const glow_outer_half = glow_w * s * 0.5;
    const glow_inner_half = glow_w * s * 0.275;
    const core_half = stroke_w * s * 0.5;
    const hot_half = @max(0.25, stroke_w * s * 0.2);
    const c_glow_outer = withGlowAlpha(glow, ga * 0.4);
    const c_glow_inner = withGlowAlpha(glow, ga * 0.7);
    const c_core = withGlowAlpha(stroke, op);
    const c_hot = [4]u8{ 255, 255, 255, @trunc(std.math.clamp(0.85 * 255.0 * op, 0, 255)) };
    // pass order: outer glow → inner glow → core → hot center (back to front)
    for (segs.items) |g| strokeSeg(out, ow, oh, g.ax, g.ay, g.bx, g.by, glow_outer_half, c_glow_outer);
    for (segs.items) |g| strokeSeg(out, ow, oh, g.ax, g.ay, g.bx, g.by, glow_inner_half, c_glow_inner);
    for (segs.items) |g| strokeSeg(out, ow, oh, g.ax, g.ay, g.bx, g.by, core_half, c_core);
    for (segs.items) |g| strokeSeg(out, ow, oh, g.ax, g.ay, g.bx, g.by, hot_half, c_hot);
}

// ── the door ────────────────────────────────────────────────────────────────

/// Run a packed decal recipe into a fresh RGBA buffer (caller frees `rgba`
/// with the same allocator). `images` is the content-addressed payload table
/// image nodes reference by key (constructor.Scene.decal_assets — pass empty
/// when the gamefile ships none). Null on malformed input or OOM — callers
/// leave the face on its flat fallback color.
pub fn rasterize(allocator: std.mem.Allocator, doc: []const u8, images: []const ImageAsset) ?Raster {
    var r = Reader{ .bytes = doc };
    const doc_w = r.u16v() orelse return null;
    const doc_h = r.u16v() orelse return null;
    if (doc_w < MIN_DOC_SIDE or doc_h < MIN_DOC_SIDE or doc_w > MAX_DOC_SIDE or doc_h > MAX_DOC_SIDE) return null;
    const bg = r.rgba() orelse return null;
    const node_count = r.u16v() orelse return null;
    if (node_count > MAX_NODES) return null;

    // Uniform scale: rasterize at doc resolution, capped — glyph fidelity
    // needs uniform s (DecalSurface's min-axis font scaling, exact here).
    const s = @min(1.0, RASTER_MAX_SIDE / @as(f32, @floatFromInt(@max(doc_w, doc_h))));
    const ow: u32 = @trunc(@max(1, @round(@as(f32, @floatFromInt(doc_w)) * s)));
    const oh: u32 = @trunc(@max(1, @round(@as(f32, @floatFromInt(doc_h)) * s)));

    const out = allocator.alloc(u8, @as(usize, ow) * @as(usize, oh) * 4) catch return null;
    errdefer allocator.free(out);
    {
        var i: usize = 0;
        while (i < out.len) : (i += 4) {
            out[i + 0] = bg[0];
            out[i + 1] = bg[1];
            out[i + 2] = bg[2];
            out[i + 3] = bg[3];
        }
    }

    var n: u16 = 0;
    while (n < node_count) : (n += 1) {
        const kind = r.u8v() orelse return fail(allocator, out);
        const x = (r.f32v() orelse return fail(allocator, out)) * s;
        const y = (r.f32v() orelse return fail(allocator, out)) * s;
        const w = (r.f32v() orelse return fail(allocator, out)) * s;
        const h = (r.f32v() orelse return fail(allocator, out)) * s;
        const opacity = r.f32v() orelse return fail(allocator, out);
        switch (kind) {
            NODE_RECT => {
                const fill = r.rgba() orelse return fail(allocator, out);
                const radius = (r.f32v() orelse return fail(allocator, out)) * s;
                const border_w = (r.f32v() orelse return fail(allocator, out)) * s;
                const border = r.rgba() orelse return fail(allocator, out);
                fillRect(out, ow, oh, x, y, w, h, fill, radius, border_w, border, opacity);
            },
            NODE_TEXT => {
                const color = r.rgba() orelse return fail(allocator, out);
                const font_size = r.f32v() orelse return fail(allocator, out);
                const weight = r.u16v() orelse return fail(allocator, out);
                const align_b = r.u8v() orelse return fail(allocator, out);
                const letter_spacing = (r.f32v() orelse return fail(allocator, out)) * s;
                const len = r.u16v() orelse return fail(allocator, out);
                if (len > MAX_TEXT_BYTES) return fail(allocator, out);
                const text = r.slice(len) orelse return fail(allocator, out);
                const px: u16 = @trunc(std.math.clamp(@round(font_size * s), 1, 512));
                drawTextNode(out, ow, oh, x, y, w, h, color, px, weight, align_b, letter_spacing, text, opacity);
            },
            NODE_IMAGE => {
                const asset_key = r.u32v() orelse return fail(allocator, out);
                const radius = (r.f32v() orelse return fail(allocator, out)) * s;
                const len = r.u16v() orelse return fail(allocator, out);
                if (len > MAX_TEXT_BYTES) return fail(allocator, out);
                const src = r.slice(len) orelse return fail(allocator, out);
                if (asset_key == 0) {
                    log.warn(.render, "[decal-raster] image node ('{s}') shipped no asset (empty/unreadable src at bake) — MISSING checkerboard", .{src});
                    drawMissingChecker(out, ow, oh, x, y, w, h, opacity);
                } else if (findImage(images, asset_key)) |payload| {
                    drawImageNode(out, ow, oh, x, y, w, h, radius, opacity, payload, src);
                } else {
                    log.warn(.render, "[decal-raster] image node ('{s}') references asset key {d} with no installed payload — MISSING checkerboard", .{ src, asset_key });
                    drawMissingChecker(out, ow, oh, x, y, w, h, opacity);
                }
            },
            NODE_PATH => {
                const stroke = r.rgba() orelse return fail(allocator, out);
                const stroke_w = r.f32v() orelse return fail(allocator, out);
                const glow = r.rgba() orelse return fail(allocator, out);
                const glow_w = r.f32v() orelse return fail(allocator, out);
                const glow_a = r.f32v() orelse return fail(allocator, out);
                _ = r.rgba() orelse return fail(allocator, out); // fill RGBA — interior fill is the marked follow-up; the tube is the neon
                const len = r.u16v() orelse return fail(allocator, out);
                if (len > MAX_PATH_D_BYTES) return fail(allocator, out);
                const d = r.slice(len) orelse return fail(allocator, out);
                // widths carry their own ×s inside drawNeonPath (the `d` coords
                // scale on append); x/y/w/h above are the bbox hint, unused here.
                drawNeonPath(allocator, out, ow, oh, s, opacity, stroke, stroke_w, glow, glow_w, glow_a, d);
            },
            else => return fail(allocator, out),
        }
    }
    if (r.at != doc.len) return fail(allocator, out); // trailing garbage = malformed

    // Output is top-down (row 0 = the doc's top), the texture convention every
    // producer shares. UVFLIP-0610: the 180° pixel-order reversal that lived
    // here (DECALFLIP-0610) compensated for world_loader's buildCube carrying
    // v=0 at world BOTTOM — upside-down UVs that ALSO flipped every shader
    // material (the user's door) and, half-corrected, mirrored decal u. The
    // cube now wears the geometry registry's addFace convention (v=0 at world
    // top — runtime/geometries/_util.ts face()), so the compensation is gone:
    // one convention, fixed at the sampling geometry, not per producer.
    return .{ .rgba = out, .w = ow, .h = oh };
}

fn fail(allocator: std.mem.Allocator, out: []u8) ?Raster {
    allocator.free(out);
    return null;
}
