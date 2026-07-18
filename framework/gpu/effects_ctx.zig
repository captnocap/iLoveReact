//! effect_ctx.zig — Composable Effect API context
//!
//! The EffectContext is what user-compiled onRender callbacks receive.
//! It wraps a CPU pixel buffer and provides drawing primitives + timing.
//! Math delegates to framework/math.zig. Color conversion (HSV/HSL→RGB)
//! lives here since math.zig is purely geometric.
//!
//! Usage in .tsz:
//!   <Effect onRender={(e) => {
//!     for (let y = 0; y < e.height; y++) {
//!       for (let x = 0; x < e.width; x++) {
//!         const d = e.sin(x * 0.1 + e.time) * 0.5 + 0.5;
//!         e.setPixel(x, y, d, d * 0.5, 1.0 - d, 1.0);
//!       }
//!     }
//!   }} width={400} height={300} />
//!
//! The compiler translates e.sin → @sin, e.noise → math.noise2d, etc.
//! Only buffer ops and color conversion are actual methods on this struct.

const std = @import("std");
const math = @import("../math/root.zig");

/// Function signature for user-compiled effect render callbacks.
pub const RenderFn = *const fn (*EffectContext) void;

pub const EffectContext = struct {
    // ── Pixel buffer ──
    buf: [*]u8,
    width: u32,
    height: u32,
    stride: u32, // bytes per row (width * 4)

    // ── Timing ──
    time: f32, // seconds since effect creation
    dt: f32, // delta time this frame

    // ── Mouse (local coordinates relative to effect bounds) ──
    mouse_x: f32,
    mouse_y: f32,
    mouse_inside: bool,

    // ── Frame counter ──
    frame: u32,

    // ── Shim plumbing ──
    // Opaque payload the host sets before invoking a render callback. QJS uses
    // this to carry the React node id so the render shim can look up the JS
    // closure registered via handlerRegistry.
    user_data: usize = 0,
    /// Explicit owner for host-backed render shims. The effect instance copies
    /// this from its Node before invoking `RenderFn`; pure native effects leave
    /// it null.
    callback_context: ?*anyopaque = null,

    // ── Source buffer (mask mode only) ──
    // When non-null, this is the captured parent content for post-processing.
    // Masks read from source (parent's rendered pixels) and write to buf (output).
    source: ?[*]const u8 = null,
    source_width: u32 = 0,
    source_height: u32 = 0,

    // ════════════════════════════════════════════════════════════════
    // Pixel operations
    // ════════════════════════════════════════════════════════════════

    /// Write a pixel at (x, y) with RGBA floats in 0..1 range.
    /// Coords are f32 since for-loop vars get float-casted for math compatibility.
    pub fn setPixel(self: *EffectContext, x: f32, y: f32, r: f32, g: f32, b: f32, a: f32) void {
        if (x < 0 or y < 0) return;
        const ux: u32 = @intFromFloat(x);
        const uy: u32 = @intFromFloat(y);
        if (ux >= self.width or uy >= self.height) return;
        const idx = @as(usize, uy) * @as(usize, self.stride) + @as(usize, ux) * 4;
        self.buf[idx] = @intFromFloat(std.math.clamp(r, 0, 1) * 255);
        self.buf[idx + 1] = @intFromFloat(std.math.clamp(g, 0, 1) * 255);
        self.buf[idx + 2] = @intFromFloat(std.math.clamp(b, 0, 1) * 255);
        self.buf[idx + 3] = @intFromFloat(std.math.clamp(a, 0, 1) * 255);
    }

    /// Write a pixel with integer RGBA 0..255.
    pub fn setPixelRaw(self: *EffectContext, x: u32, y: u32, r: u8, g: u8, b: u8, a: u8) void {
        if (x >= self.width or y >= self.height) return;
        const idx = @as(usize, y) * @as(usize, self.stride) + @as(usize, x) * 4;
        self.buf[idx] = r;
        self.buf[idx + 1] = g;
        self.buf[idx + 2] = b;
        self.buf[idx + 3] = a;
    }

    /// Read a pixel at (x, y) → [r, g, b, a] as floats 0..1.
    pub fn getPixel(self: *const EffectContext, x: f32, y: f32) [4]f32 {
        if (x < 0 or y < 0) return .{ 0, 0, 0, 0 };
        const ux: u32 = @intFromFloat(x);
        const uy: u32 = @intFromFloat(y);
        if (ux >= self.width or uy >= self.height) return .{ 0, 0, 0, 0 };
        const idx = @as(usize, uy) * @as(usize, self.stride) + @as(usize, ux) * 4;
        return .{
            @as(f32, @floatFromInt(self.buf[idx])) / 255.0,
            @as(f32, @floatFromInt(self.buf[idx + 1])) / 255.0,
            @as(f32, @floatFromInt(self.buf[idx + 2])) / 255.0,
            @as(f32, @floatFromInt(self.buf[idx + 3])) / 255.0,
        };
    }

    /// Read a pixel from the source buffer (mask mode only).
    /// Returns the parent's rendered content at (x, y) as [r, g, b, a] floats 0..1.
    /// Returns zero if no source is set (standalone/background mode).
    pub fn getSource(self: *const EffectContext, x: f32, y: f32) [4]f32 {
        const src = self.source orelse return .{ 0, 0, 0, 0 };
        if (x < 0 or y < 0) return .{ 0, 0, 0, 0 };
        const ux: u32 = @intFromFloat(x);
        const uy: u32 = @intFromFloat(y);
        if (ux >= self.source_width or uy >= self.source_height) return .{ 0, 0, 0, 0 };
        const src_stride = self.source_width * 4;
        const idx = @as(usize, uy) * @as(usize, src_stride) + @as(usize, ux) * 4;
        return .{
            @as(f32, @floatFromInt(src[idx])) / 255.0,
            @as(f32, @floatFromInt(src[idx + 1])) / 255.0,
            @as(f32, @floatFromInt(src[idx + 2])) / 255.0,
            @as(f32, @floatFromInt(src[idx + 3])) / 255.0,
        };
    }

    /// Read just the alpha of a source pixel (mask mode only).
    /// Returns 0.0 if outside bounds or no source. Useful for shape clipping.
    pub fn getSourceAlpha(self: *const EffectContext, x: f32, y: f32) f32 {
        const src = self.source orelse return 0;
        if (x < 0 or y < 0) return 0;
        const ux: u32 = @intFromFloat(x);
        const uy: u32 = @intFromFloat(y);
        if (ux >= self.source_width or uy >= self.source_height) return 0;
        const src_stride = self.source_width * 4;
        const idx = @as(usize, uy) * @as(usize, src_stride) + @as(usize, ux) * 4;
        return @as(f32, @floatFromInt(src[idx + 3])) / 255.0;
    }

    /// Read the RGB of a source pixel (mask mode only). Returns [r, g, b] as 0..1.
    pub fn getSourceR(self: *const EffectContext, x: f32, y: f32) f32 {
        const src = self.source orelse return 0;
        if (x < 0 or y < 0) return 0;
        const ux: u32 = @intFromFloat(x);
        const uy: u32 = @intFromFloat(y);
        if (ux >= self.source_width or uy >= self.source_height) return 0;
        const idx = @as(usize, uy) * @as(usize, self.source_width * 4) + @as(usize, ux) * 4;
        return @as(f32, @floatFromInt(src[idx])) / 255.0;
    }

    pub fn getSourceG(self: *const EffectContext, x: f32, y: f32) f32 {
        const src = self.source orelse return 0;
        if (x < 0 or y < 0) return 0;
        const ux: u32 = @intFromFloat(x);
        const uy: u32 = @intFromFloat(y);
        if (ux >= self.source_width or uy >= self.source_height) return 0;
        const idx = @as(usize, uy) * @as(usize, self.source_width * 4) + @as(usize, ux) * 4;
        return @as(f32, @floatFromInt(src[idx + 1])) / 255.0;
    }

    pub fn getSourceB(self: *const EffectContext, x: f32, y: f32) f32 {
        const src = self.source orelse return 0;
        if (x < 0 or y < 0) return 0;
        const ux: u32 = @intFromFloat(x);
        const uy: u32 = @intFromFloat(y);
        if (ux >= self.source_width or uy >= self.source_height) return 0;
        const idx = @as(usize, uy) * @as(usize, self.source_width * 4) + @as(usize, ux) * 4;
        return @as(f32, @floatFromInt(src[idx + 2])) / 255.0;
    }

    /// Clear entire buffer to transparent black.
    pub fn clear(self: *EffectContext) void {
        @memset(self.buf[0 .. @as(usize, self.height) * @as(usize, self.stride)], 0);
    }

    /// Clear entire buffer to a specific RGBA color (floats 0..1).
    pub fn clearColor(self: *EffectContext, r: f32, g: f32, b: f32, a: f32) void {
        const rb: u8 = @intFromFloat(std.math.clamp(r, 0, 1) * 255);
        const gb: u8 = @intFromFloat(std.math.clamp(g, 0, 1) * 255);
        const bb: u8 = @intFromFloat(std.math.clamp(b, 0, 1) * 255);
        const ab: u8 = @intFromFloat(std.math.clamp(a, 0, 1) * 255);
        const total = @as(usize, self.height) * @as(usize, self.stride);
        var i: usize = 0;
        while (i < total) : (i += 4) {
            self.buf[i] = rb;
            self.buf[i + 1] = gb;
            self.buf[i + 2] = bb;
            self.buf[i + 3] = ab;
        }
    }

    /// Fill a rectangle with RGBA color (floats 0..1).
    pub fn fillRect(self: *EffectContext, rx: u32, ry: u32, rw: u32, rh: u32, r: f32, g: f32, b: f32, a: f32) void {
        const rb: u8 = @intFromFloat(std.math.clamp(r, 0, 1) * 255);
        const gb: u8 = @intFromFloat(std.math.clamp(g, 0, 1) * 255);
        const bb: u8 = @intFromFloat(std.math.clamp(b, 0, 1) * 255);
        const ab: u8 = @intFromFloat(std.math.clamp(a, 0, 1) * 255);
        const x_end = @min(rx + rw, self.width);
        const y_end = @min(ry + rh, self.height);
        var py = ry;
        while (py < y_end) : (py += 1) {
            var px = rx;
            while (px < x_end) : (px += 1) {
                const idx = @as(usize, py) * @as(usize, self.stride) + @as(usize, px) * 4;
                self.buf[idx] = rb;
                self.buf[idx + 1] = gb;
                self.buf[idx + 2] = bb;
                self.buf[idx + 3] = ab;
            }
        }
    }

    /// Alpha-blend a pixel on top of existing content.
    pub fn blendPixel(self: *EffectContext, x: u32, y: u32, r: f32, g: f32, b: f32, a: f32) void {
        if (x >= self.width or y >= self.height) return;
        const idx = @as(usize, y) * @as(usize, self.stride) + @as(usize, x) * 4;
        const sa = std.math.clamp(a, 0, 1);
        const inv_a = 1.0 - sa;
        const dr = @as(f32, @floatFromInt(self.buf[idx])) / 255.0;
        const dg = @as(f32, @floatFromInt(self.buf[idx + 1])) / 255.0;
        const db = @as(f32, @floatFromInt(self.buf[idx + 2])) / 255.0;
        const da = @as(f32, @floatFromInt(self.buf[idx + 3])) / 255.0;
        self.buf[idx] = @intFromFloat(std.math.clamp(r * sa + dr * inv_a, 0, 1) * 255);
        self.buf[idx + 1] = @intFromFloat(std.math.clamp(g * sa + dg * inv_a, 0, 1) * 255);
        self.buf[idx + 2] = @intFromFloat(std.math.clamp(b * sa + db * inv_a, 0, 1) * 255);
        self.buf[idx + 3] = @intFromFloat(std.math.clamp(sa + da * inv_a, 0, 1) * 255);
    }

    /// Fade entire buffer — multiply all alpha values by `factor` (0..1).
    /// Useful for trail/decay effects.
    pub fn fade(self: *EffectContext, factor: f32) void {
        const total = @as(usize, self.height) * @as(usize, self.stride);
        var i: usize = 3; // start at first alpha byte
        while (i < total) : (i += 4) {
            const old_a: f32 = @floatFromInt(self.buf[i]);
            self.buf[i] = @intFromFloat(old_a * std.math.clamp(factor, 0, 1));
        }
    }

    // ════════════════════════════════════════════════════════════════
    // Drawing primitives
    // ════════════════════════════════════════════════════════════════

    /// Draw a line using Bresenham's algorithm.
    pub fn line(self: *EffectContext, x0i: i32, y0i: i32, x1i: i32, y1i: i32, r: f32, g: f32, b: f32, a: f32) void {
        var x0 = x0i;
        var y0 = y0i;
        const dx = @as(i32, if (x1i > x0i) x1i - x0i else x0i - x1i);
        const dy = -@as(i32, if (y1i > y0i) y1i - y0i else y0i - y1i);
        const sx: i32 = if (x0i < x1i) 1 else -1;
        const sy: i32 = if (y0i < y1i) 1 else -1;
        var err = dx + dy;

        while (true) {
            if (x0 >= 0 and y0 >= 0) {
                self.setPixel(@intCast(x0), @intCast(y0), r, g, b, a);
            }
            if (x0 == x1i and y0 == y1i) break;
            const e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x0 += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    /// Draw a circle outline using midpoint algorithm.
    pub fn circle(self: *EffectContext, cx: i32, cy: i32, radius: u32, r: f32, g: f32, b: f32, a: f32) void {
        if (radius == 0) {
            if (cx >= 0 and cy >= 0) self.setPixel(@intCast(cx), @intCast(cy), r, g, b, a);
            return;
        }
        var x: i32 = @intCast(radius);
        var y: i32 = 0;
        var d: i32 = 1 - x;

        while (x >= y) {
            self.setPixelI(cx + x, cy + y, r, g, b, a);
            self.setPixelI(cx - x, cy + y, r, g, b, a);
            self.setPixelI(cx + x, cy - y, r, g, b, a);
            self.setPixelI(cx - x, cy - y, r, g, b, a);
            self.setPixelI(cx + y, cy + x, r, g, b, a);
            self.setPixelI(cx - y, cy + x, r, g, b, a);
            self.setPixelI(cx + y, cy - x, r, g, b, a);
            self.setPixelI(cx - y, cy - x, r, g, b, a);
            y += 1;
            if (d <= 0) {
                d += 2 * y + 1;
            } else {
                x -= 1;
                d += 2 * (y - x) + 1;
            }
        }
    }

    /// Draw a filled circle.
    pub fn circleFill(self: *EffectContext, cx: i32, cy: i32, radius: u32, r: f32, g: f32, b: f32, a: f32) void {
        const ri: i32 = @intCast(radius);
        var py = cy - ri;
        while (py <= cy + ri) : (py += 1) {
            if (py < 0 or py >= @as(i32, @intCast(self.height))) continue;
            const dy = py - cy;
            const half_w: i32 = @intFromFloat(@sqrt(@as(f32, @floatFromInt(ri * ri - dy * dy))));
            var px = @max(0, cx - half_w);
            const x_end = @min(@as(i32, @intCast(self.width)), cx + half_w + 1);
            while (px < x_end) : (px += 1) {
                self.setPixel(@intCast(px), @intCast(py), r, g, b, a);
            }
        }
    }

    /// Helper: setPixel with signed coordinates (clips negative).
    fn setPixelI(self: *EffectContext, x: i32, y: i32, r: f32, g: f32, b: f32, a: f32) void {
        if (x < 0 or y < 0) return;
        self.setPixel(@intCast(x), @intCast(y), r, g, b, a);
    }

    // ════════════════════════════════════════════════════════════════
    // Color space conversion
    // ════════════════════════════════════════════════════════════════

    /// HSV to RGB. All inputs/outputs in 0..1 range.
    pub fn hsvToRgb(h_in: f32, s: f32, v: f32) [3]f32 {
        if (s <= 0) return .{ v, v, v };
        const h = @mod(h_in, 1.0) * 6.0;
        const sector = @as(u32, @intFromFloat(@floor(h)));
        const f = h - @as(f32, @floatFromInt(sector));
        const p = v * (1.0 - s);
        const q = v * (1.0 - s * f);
        const t = v * (1.0 - s * (1.0 - f));
        return switch (sector % 6) {
            0 => .{ v, t, p },
            1 => .{ q, v, p },
            2 => .{ p, v, t },
            3 => .{ p, q, v },
            4 => .{ t, p, v },
            5 => .{ v, p, q },
            else => .{ v, v, v },
        };
    }

    /// HSL to RGB. All inputs/outputs in 0..1 range.
    /// Port of love2d/lua/effects/util.lua hslToRgb.
    pub fn hslToRgb(h_in: f32, s: f32, l: f32) [3]f32 {
        if (s <= 0) return .{ l, l, l };
        const h = @mod(h_in, 1.0);
        const q = if (l < 0.5) l * (1.0 + s) else l + s - l * s;
        const p = 2.0 * l - q;
        return .{
            hue2rgb(p, q, h + 1.0 / 3.0),
            hue2rgb(p, q, h),
            hue2rgb(p, q, h - 1.0 / 3.0),
        };
    }

    fn hue2rgb(p: f32, q: f32, t_in: f32) f32 {
        var t = t_in;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
        if (t < 0.5) return q;
        if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        return p;
    }

    // ════════════════════════════════════════════════════════════════
    // Convenience wrappers (delegate to math.zig)
    // These exist so the compiler can translate e.noise(x,y) → ctx.noise(x,y)
    // without needing a separate math import in the generated code.
    // ════════════════════════════════════════════════════════════════

    /// Perlin noise at (x, y), returns -1..1.
    pub fn noise(self: *const EffectContext, x: f32, y: f32) f32 {
        _ = self;
        return math.noise2d(x, y, 0);
    }

    /// 3D Perlin noise at (x, y, z), returns -1..1.
    pub fn noise3(self: *const EffectContext, x: f32, y: f32, z: f32) f32 {
        _ = self;
        return math.noise3d(x, y, z, 0);
    }

    /// Fractal Brownian motion noise (layered octaves).
    pub fn fbm(self: *const EffectContext, x: f32, y: f32, octaves: u32) f32 {
        _ = self;
        return math.fbm2d(x, y, octaves, 0, 2.0, 0.5);
    }

    /// Linear interpolation.
    pub fn lerp(_: *const EffectContext, a: f32, b: f32, t: f32) f32 {
        return math.lerp(a, b, t);
    }

    /// Remap a value from one range to another.
    pub fn remap(_: *const EffectContext, value: f32, in_min: f32, in_max: f32, out_min: f32, out_max: f32) f32 {
        return math.remap(value, in_min, in_max, out_min, out_max);
    }

    /// Clamp a value to [lo, hi].
    pub fn clampVal(_: *const EffectContext, value: f32, lo: f32, hi: f32) f32 {
        return math.clamp(value, lo, hi);
    }

    /// Smoothstep interpolation.
    pub fn smoothstep(_: *const EffectContext, edge0: f32, edge1: f32, x: f32) f32 {
        return math.smoothstep(edge0, edge1, x);
    }

    /// Distance between two points.
    pub fn dist(_: *const EffectContext, x0: f32, y0: f32, x1: f32, y1: f32) f32 {
        return math.v2distance(.{ .x = x0, .y = y0 }, .{ .x = x1, .y = y1 });
    }

    /// Step function: 0 if x < edge, 1 if x >= edge.
    pub fn step(_: *const EffectContext, edge: f32, x: f32) f32 {
        return math.step(edge, x);
    }

    /// Voronoi cellular noise. Returns [2]f32: [nearest_dist, second_nearest_dist].
    pub fn voronoi(_: *const EffectContext, px: f32, py: f32) [2]f32 {
        const n = math.v2floor(.{ .x = px, .y = py });
        const f = .{ .x = px - n.x, .y = py - n.y };
        var md: f32 = 8.0;
        var md2: f32 = 8.0;
        var j: i32 = -1;
        while (j <= 1) : (j += 1) {
            var i: i32 = -1;
            while (i <= 1) : (i += 1) {
                const gx = @as(f32, @floatFromInt(i));
                const gy = @as(f32, @floatFromInt(j));
                const h = math.noise2d(n.x + gx, n.y + gy, 0);
                const ox = (h + 1.0) * 0.5;
                const h2 = math.noise2d(n.x + gx + 127.1, n.y + gy + 311.7, 0);
                const oy = (h2 + 1.0) * 0.5;
                const rx = gx + ox - f.x;
                const ry = gy + oy - f.y;
                const d = rx * rx + ry * ry;
                if (d < md) {
                    md2 = md;
                    md = d;
                } else if (d < md2) {
                    md2 = d;
                }
            }
        }
        return .{ @sqrt(md), @sqrt(md2) };
    }
};
