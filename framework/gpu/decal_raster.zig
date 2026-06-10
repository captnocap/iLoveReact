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
//!     image: u16 srcByteLen | utf8 bytes  (v1: logged + skipped — image
//!            payloads ride the content-addressed asset store next)
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

const MIN_DOC_SIDE = 8;
const MAX_DOC_SIDE = 4096;
const MAX_NODES = 256;
const MAX_TEXT_BYTES = 4096;
/// Longest rasterized side — bounds the transient buffer (a 4096² doc would
/// be 64MB); the texture stretches onto its face anyway. 512-1024 reads
/// crisp at game scale (shader materials materialize at 256).
const RASTER_MAX_SIDE: f32 = 1024;

pub const Raster = struct {
    rgba: []u8,
    w: u32,
    h: u32,
};

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
    const a = (@as(f32, @floatFromInt(color[3])) / 255.0) * std.math.clamp(coverage, 0, 1);
    if (a <= 0) return;
    const inv = 1 - a;
    const dr: f32 = @floatFromInt(out[i + 0]);
    const dg: f32 = @floatFromInt(out[i + 1]);
    const db: f32 = @floatFromInt(out[i + 2]);
    const da: f32 = @as(f32, @floatFromInt(out[i + 3])) / 255.0;
    out[i + 0] = @intFromFloat(std.math.clamp(@as(f32, @floatFromInt(color[0])) * a + dr * inv, 0, 255));
    out[i + 1] = @intFromFloat(std.math.clamp(@as(f32, @floatFromInt(color[1])) * a + dg * inv, 0, 255));
    out[i + 2] = @intFromFloat(std.math.clamp(@as(f32, @floatFromInt(color[2])) * a + db * inv, 0, 255));
    out[i + 3] = @intFromFloat(std.math.clamp((a + da * inv) * 255.0, 0, 255));
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
    const x0: i64 = @intFromFloat(@floor(x - 1));
    const y0: i64 = @intFromFloat(@floor(y - 1));
    const x1: i64 = @intFromFloat(@ceil(x + w + 1));
    const y1: i64 = @intFromFloat(@ceil(y + h + 1));
    var fill_c = fill;
    fill_c[3] = @intFromFloat(@as(f32, @floatFromInt(fill[3])) * std.math.clamp(opacity, 0, 1));
    var border_c = border;
    border_c[3] = @intFromFloat(@as(f32, @floatFromInt(border[3])) * std.math.clamp(opacity, 0, 1));
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
    color[3] = @intFromFloat(@as(f32, @floatFromInt(color_in[3])) * std.math.clamp(opacity, 0, 1));

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
            const gx0: i64 = @as(i64, @intFromFloat(@floor(pen_x))) + @as(i64, glyph.*.bitmap_left);
            const gy0: i64 = @as(i64, @intFromFloat(@floor(baseline))) - @as(i64, glyph.*.bitmap_top);
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
                    blend(out, i, color, @as(f32, @floatFromInt(cov)) / 255.0);
                }
            }
        }
        pen_x += @as(f32, @floatFromInt(glyph.*.advance.x)) / 64.0 + letter_spacing;
    }
}

// ── the door ────────────────────────────────────────────────────────────────

/// Run a packed decal recipe into a fresh RGBA buffer (caller frees `rgba`
/// with the same allocator). Null on malformed input or OOM — callers leave
/// the face on its flat fallback color.
pub fn rasterize(allocator: std.mem.Allocator, doc: []const u8) ?Raster {
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
    const ow: u32 = @intFromFloat(@max(1, @round(@as(f32, @floatFromInt(doc_w)) * s)));
    const oh: u32 = @intFromFloat(@max(1, @round(@as(f32, @floatFromInt(doc_h)) * s)));

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
                const px: u16 = @intFromFloat(std.math.clamp(@round(font_size * s), 1, 512));
                drawTextNode(out, ow, oh, x, y, w, h, color, px, weight, align_b, letter_spacing, text, opacity);
            },
            NODE_IMAGE => {
                const len = r.u16v() orelse return fail(allocator, out);
                if (len > MAX_TEXT_BYTES) return fail(allocator, out);
                const src = r.slice(len) orelse return fail(allocator, out);
                log.warn(.render, "[decal-raster] image node ('{s}') skipped — image payloads ride the content-addressed asset store (follow-up)", .{src});
            },
            else => return fail(allocator, out),
        }
    }
    if (r.at != doc.len) return fail(allocator, out); // trailing garbage = malformed

    return .{ .rgba = out, .w = ow, .h = oh };
}

fn fail(allocator: std.mem.Allocator, out: []u8) ?Raster {
    allocator.free(out);
    return null;
}
