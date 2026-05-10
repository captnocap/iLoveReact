//! Blend2D integration — 2D vector graphics via CPU rasterization + GPU texture upload.
//!
//! Provides filled path rendering (SVG paths, circles, rounded rects, gradients)
//! by rasterizing to a pixel buffer with Blend2D, then uploading as a wgpu texture
//! displayed via the images pipeline.
//!
//! The surface is created once and reused each frame. Pixel format is PRGB32
//! (premultiplied ARGB), which maps directly to BGRA8 on little-endian.

const std = @import("std");
const log = @import("../diag/log.zig");
const gpu = @import("gpu.zig");
const wgpu = @import("wgpu");
const m = @import("../math/root.zig");

var g_paisley_debug_enabled: ?bool = null;

fn paisleyDebugEnabled() bool {
    if (g_paisley_debug_enabled == null) {
        g_paisley_debug_enabled = std.posix.getenv("ZIGOS_PAISLEY_DEBUG") != null;
    }
    return g_paisley_debug_enabled.?;
}

// ── C FFI declarations (from ffi/blend2d_shim.h) ──────────────────────

const B2DSurface = opaque {};

extern "c" fn b2d_create(width: c_int, height: c_int) ?*B2DSurface;
extern "c" fn b2d_destroy(s: *B2DSurface) void;
extern "c" fn b2d_clear(s: *B2DSurface) void;
extern "c" fn b2d_set_fill_rgba32(s: *B2DSurface, rgba32: u32) void;
extern "c" fn b2d_set_stroke_rgba32(s: *B2DSurface, rgba32: u32) void;
extern "c" fn b2d_set_stroke_width(s: *B2DSurface, width: f64) void;
extern "c" fn b2d_set_comp_op(s: *B2DSurface, op: c_int) void;
extern "c" fn b2d_set_global_alpha(s: *B2DSurface, alpha: f64) void;
extern "c" fn b2d_path_reset(s: *B2DSurface) void;
extern "c" fn b2d_path_from_svg(s: *B2DSurface, svg_d: [*]const u8, len: usize) void;
extern "c" fn b2d_fill_path(s: *B2DSurface) void;
extern "c" fn b2d_stroke_path(s: *B2DSurface) void;
extern "c" fn b2d_reset_transform(s: *B2DSurface) void;
extern "c" fn b2d_translate(s: *B2DSurface, tx: f64, ty: f64) void;
extern "c" fn b2d_scale(s: *B2DSurface, sx: f64, sy: f64) void;
extern "c" fn b2d_get_pixels(s: *B2DSurface) ?[*]const u8;

// ── Shared surface for Graph.Path fill rendering ──────────────────────

var g_surface: ?*B2DSurface = null;
var g_surface_w: u32 = 0;
var g_surface_h: u32 = 0;

// GPU texture for uploading blend2d output
var g_texture: ?*wgpu.Texture = null;
var g_texture_view: ?*wgpu.TextureView = null;
var g_sampler: ?*wgpu.Sampler = null;
var g_bind_group: ?*wgpu.BindGroup = null;

const MAX_TRANSIENT_FILLS = 256;

const TransientFill = struct {
    texture: ?*wgpu.Texture = null,
    texture_view: ?*wgpu.TextureView = null,
    bind_group: ?*wgpu.BindGroup = null,
    width: u32 = 0,
    height: u32 = 0,
};

var g_transient_fills: [MAX_TRANSIENT_FILLS]TransientFill = [_]TransientFill{.{}} ** MAX_TRANSIENT_FILLS;
var g_transient_fill_count: usize = 0;

fn ensureSurface(w: u32, h: u32) ?*B2DSurface {
    if (g_surface != null and g_surface_w == w and g_surface_h == h) {
        return g_surface;
    }
    // Destroy old
    if (g_surface) |s| b2d_destroy(s);
    if (g_texture_view) |v| v.release();
    if (g_texture) |t| t.release();
    if (g_bind_group) |bg| bg.release();
    g_texture = null;
    g_texture_view = null;
    g_bind_group = null;

    g_surface = b2d_create(@intCast(w), @intCast(h));
    if (g_surface == null) return null;
    g_surface_w = w;
    g_surface_h = h;

    // Create GPU texture
    const device = gpu.getDevice() orelse return g_surface;
    g_texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("blend2d_surface"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = gpu.getFormat(),
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return g_surface;
    g_texture_view = g_texture.?.createView(null);

    // Sampler
    if (g_sampler == null) {
        g_sampler = device.createSampler(&.{
            .address_mode_u = .clamp_to_edge,
            .address_mode_v = .clamp_to_edge,
            .mag_filter = .linear,
            .min_filter = .linear,
        });
    }

    // Bind group for images pipeline
    if (g_texture_view) |tv| {
        if (g_sampler) |samp| {
            g_bind_group = gpu.images.createBindGroup(tv, samp);
        }
    }

    return g_surface;
}

fn uploadToGPU(w: u32, h: u32) void {
    const s = g_surface orelse return;
    const pixels = b2d_get_pixels(s) orelse return;
    const queue = gpu.getQueue() orelse return;
    const texture = g_texture orelse return;

    // PRGB32 on little-endian is already BGRA byte order — direct upload
    const byte_size = w * h * 4;
    queue.writeTexture(
        &.{ .texture = texture, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        pixels,
        byte_size,
        &.{ .offset = 0, .bytes_per_row = w * 4, .rows_per_image = h },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
}

fn ensureSampler(device: *wgpu.Device) ?*wgpu.Sampler {
    if (g_sampler == null) {
        g_sampler = device.createSampler(&.{
            .address_mode_u = .clamp_to_edge,
            .address_mode_v = .clamp_to_edge,
            .mag_filter = .linear,
            .min_filter = .linear,
        });
    }
    return g_sampler;
}

fn flipRows(pixels: [*]u8, w: u32, h: u32) void {
    const row_bytes: usize = @as(usize, w) * 4;
    if (row_bytes > 8192 or h <= 1) return;

    var tmp: [8192]u8 = undefined;
    var top: usize = 0;
    var bot: usize = @as(usize, h) - 1;
    while (top < bot) {
        const top_row = pixels[top * row_bytes ..][0..row_bytes];
        const bot_row = pixels[bot * row_bytes ..][0..row_bytes];
        @memcpy(tmp[0..row_bytes], top_row);
        @memcpy(top_row, bot_row);
        @memcpy(bot_row, tmp[0..row_bytes]);
        top += 1;
        bot -= 1;
    }
}

fn uploadSurfaceToTexture(texture: *wgpu.Texture, w: u32, h: u32) void {
    const s = g_surface orelse return;
    const pixels_const = b2d_get_pixels(s) orelse return;
    const pixels: [*]u8 = @constCast(pixels_const);
    const queue = gpu.getQueue() orelse return;

    // Match the shared image shader's UV convention.
    flipRows(pixels, w, h);
    defer flipRows(pixels, w, h);

    queue.writeTexture(
        &.{ .texture = texture, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        pixels_const,
        w * h * 4,
        &.{ .offset = 0, .bytes_per_row = w * 4, .rows_per_image = h },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
}

fn ensureTransientFill(w: u32, h: u32) ?*TransientFill {
    if (g_transient_fill_count >= MAX_TRANSIENT_FILLS) return null;
    const slot = &g_transient_fills[g_transient_fill_count];
    g_transient_fill_count += 1;

    if (slot.bind_group != null and slot.width == w and slot.height == h) return slot;

    if (slot.bind_group) |bg| bg.release();
    if (slot.texture_view) |tv| tv.release();
    if (slot.texture) |tex| tex.release();
    slot.* = .{};

    const device = gpu.getDevice() orelse return null;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("b2d_effect_fill"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = gpu.getFormat(),
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return null;
    const tv = tex.createView(null) orelse {
        tex.release();
        return null;
    };
    const sampler = ensureSampler(device) orelse {
        tv.release();
        tex.release();
        return null;
    };
    const bg = gpu.images.createBindGroup(tv, sampler) orelse {
        tv.release();
        tex.release();
        return null;
    };

    slot.* = .{
        .texture = tex,
        .texture_view = tv,
        .bind_group = bg,
        .width = w,
        .height = h,
    };
    return slot;
}

// ── Cached fill textures (rasterize once, reuse bind group) ───────────

const MAX_FILL_CACHE = 64;

const FillCacheEntry = struct {
    path_ptr: usize = 0, // key: pointer to path string data
    color_key: u32 = 0, // key: packed RGBA
    bind_group: ?*wgpu.BindGroup = null,
    texture: ?*wgpu.Texture = null,
    texture_view: ?*wgpu.TextureView = null,
    bb_min_x: f32 = 0,
    bb_min_y: f32 = 0,
    bb_w: f32 = 0,
    bb_h: f32 = 0,
    active: bool = false,
};

var g_fill_cache: [MAX_FILL_CACHE]FillCacheEntry = [_]FillCacheEntry{.{}} ** MAX_FILL_CACHE;
var g_fill_cache_count: usize = 0;

fn packColor(r: f32, g: f32, b: f32, a: f32) u32 {
    const rb: u32 = @intFromFloat(@max(0, @min(255, r * 255.0)));
    const gb: u32 = @intFromFloat(@max(0, @min(255, g * 255.0)));
    const bb: u32 = @intFromFloat(@max(0, @min(255, b * 255.0)));
    const ab: u32 = @intFromFloat(@max(0, @min(255, a * 255.0)));
    return (ab << 24) | (rb << 16) | (gb << 8) | bb;
}

fn findCachedFill(path_ptr: usize, color_key: u32) ?*FillCacheEntry {
    for (g_fill_cache[0..g_fill_cache_count]) |*entry| {
        if (entry.active and entry.path_ptr == path_ptr and entry.color_key == color_key)
            return entry;
    }
    return null;
}

fn createCachedFill(d: []const u8, fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32, bb_min_x: f32, bb_min_y: f32, bb_w: f32, bb_h: f32, ppu: f32) ?*FillCacheEntry {
    if (g_fill_cache_count >= MAX_FILL_CACHE) return null;
    const pw: u32 = @intFromFloat(@max(1, @min(2048, @ceil(bb_w * ppu))));
    const ph: u32 = @intFromFloat(@max(1, @min(2048, @ceil(bb_h * ppu))));
    // Create a dedicated surface (not the shared one) so we don't interfere
    const s = b2d_create(@intCast(pw), @intCast(ph)) orelse return null;
    defer b2d_destroy(s);
    b2d_clear(s);
    b2d_reset_transform(s);
    const pw_f: f64 = @floatFromInt(pw);
    const ph_f: f64 = @floatFromInt(ph);
    b2d_scale(s, pw_f / @as(f64, @floatCast(bb_w)), ph_f / @as(f64, @floatCast(bb_h)));
    b2d_translate(s, -@as(f64, @floatCast(bb_min_x)), -@as(f64, @floatCast(bb_min_y)));
    const a_byte: u32 = @intFromFloat(@max(0, @min(255, fill_a * 255.0)));
    const r_byte: u32 = @intFromFloat(@max(0, @min(255, fill_r * 255.0)));
    const g_byte: u32 = @intFromFloat(@max(0, @min(255, fill_g * 255.0)));
    const b_byte: u32 = @intFromFloat(@max(0, @min(255, fill_b * 255.0)));
    b2d_set_fill_rgba32(s, (a_byte << 24) | (r_byte << 16) | (g_byte << 8) | b_byte);
    b2d_path_reset(s);
    b2d_path_from_svg(s, d.ptr, d.len);
    b2d_fill_path(s);
    // Get pixels and flip Y (blend2d=top-down, image shader expects bottom-up)
    const device = gpu.getDevice() orelse return null;
    const pixels_raw = b2d_get_pixels(s) orelse return null;
    const pixels_mut: [*]u8 = @constCast(pixels_raw);
    const row_bytes: usize = @as(usize, pw) * 4;
    var top_r: usize = 0;
    var bot_r: usize = @as(usize, ph) - 1;
    var tmp: [8192]u8 = undefined;
    while (top_r < bot_r) {
        const t_row = pixels_mut[top_r * row_bytes ..][0..row_bytes];
        const b_row = pixels_mut[bot_r * row_bytes ..][0..row_bytes];
        @memcpy(tmp[0..row_bytes], t_row);
        @memcpy(t_row, b_row);
        @memcpy(b_row, tmp[0..row_bytes]);
        top_r += 1;
        bot_r -= 1;
    }
    const pixels = pixels_raw;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("b2d_fill_cache"),
        .size = .{ .width = pw, .height = ph, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = gpu.getFormat(),
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return null;
    const tv = tex.createView(null) orelse {
        tex.release();
        return null;
    };
    const queue = gpu.getQueue() orelse {
        tv.release();
        tex.release();
        return null;
    };
    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        pixels,
        pw * ph * 4,
        &.{ .offset = 0, .bytes_per_row = pw * 4, .rows_per_image = ph },
        &.{ .width = pw, .height = ph, .depth_or_array_layers = 1 },
    );
    if (g_sampler == null) {
        g_sampler = device.createSampler(&.{
            .address_mode_u = .clamp_to_edge,
            .address_mode_v = .clamp_to_edge,
            .mag_filter = .linear,
            .min_filter = .linear,
        });
    }
    const bg = gpu.images.createBindGroup(tv, g_sampler.?) orelse {
        tv.release();
        tex.release();
        return null;
    };
    const entry = &g_fill_cache[g_fill_cache_count];
    entry.* = .{
        .path_ptr = @intFromPtr(d.ptr),
        .color_key = packColor(fill_r, fill_g, fill_b, fill_a),
        .bind_group = bg,
        .texture = tex,
        .texture_view = tv,
        .bb_min_x = bb_min_x,
        .bb_min_y = bb_min_y,
        .bb_w = bb_w,
        .bb_h = bb_h,
        .active = true,
    };
    g_fill_cache_count += 1;
    return entry;
}

// ── Public API ────────────────────────────────────────────────────────

/// Fill an SVG path. The path is in graph-space coordinates.
/// The image quad is positioned in graph-space at the path bounding box,
/// so the active GPU canvas transform maps it to screen.
///
/// `bb_*` = path bounding box in graph-space (computed by caller).
/// `pixels_per_unit` = how many pixels to rasterize per graph-space unit (quality).
pub fn fillSVGPath(
    d: []const u8,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    bb_min_x: f32,
    bb_min_y: f32,
    bb_w: f32,
    bb_h: f32,
    pixels_per_unit: f32,
) void {
    if (bb_w <= 0 or bb_h <= 0) return;
    const ppu: f32 = @max(0.5, pixels_per_unit);
    const color_key = packColor(fill_r, fill_g, fill_b, fill_a);
    // Check cache first — reuse texture from first frame
    if (findCachedFill(@intFromPtr(d.ptr), color_key)) |entry| {
        if (entry.bind_group) |bg| {
            gpu.images.queueQuad(entry.bb_min_x, entry.bb_min_y, entry.bb_w, entry.bb_h, 1.0, bg);
        }
        return;
    }
    // Cache miss — rasterize with blend2d and cache the texture
    if (createCachedFill(d, fill_r, fill_g, fill_b, fill_a, bb_min_x, bb_min_y, bb_w, bb_h, ppu)) |entry| {
        if (entry.bind_group) |bg| {
            gpu.images.queueQuad(bb_min_x, bb_min_y, bb_w, bb_h, 1.0, bg);
        }
    }
}

pub fn beginFrame() void {
    g_transient_fill_count = 0;
}

/// Fill an SVG path with a named effect surface as a real textured mask.
/// Unlike the fallback Gouraud vertex sampling path, this preserves effect detail.
pub fn fillSVGPathFromEffect(
    d: []const u8,
    effect_pixels: [*]const u8,
    effect_w: u32,
    effect_h: u32,
    bb_min_x: f32,
    bb_min_y: f32,
    bb_w: f32,
    bb_h: f32,
    opacity: f32,
    stroke_r: f32,
    stroke_g: f32,
    stroke_b: f32,
    stroke_a: f32,
    stroke_w: f32,
) void {
    if (bb_w <= 0 or bb_h <= 0 or effect_w == 0 or effect_h == 0) return;
    const alpha_mul = m.clamp01(opacity);
    if (alpha_mul <= 0) return;

    const pw: u32 = @max(1, @min(effect_w, 2048));
    const ph: u32 = @max(1, @min(effect_h, 2048));
    const s = ensureSurface(pw, ph) orelse return;

    // First rasterize the SVG fill into the surface alpha channel.
    b2d_clear(s);
    b2d_reset_transform(s);
    const pw_f: f64 = @floatFromInt(pw);
    const ph_f: f64 = @floatFromInt(ph);
    const sx: f64 = pw_f / @as(f64, @floatCast(bb_w));
    const sy: f64 = ph_f / @as(f64, @floatCast(bb_h));
    b2d_scale(s, sx, sy);
    b2d_translate(s, -@as(f64, @floatCast(bb_min_x)), -@as(f64, @floatCast(bb_min_y)));
    b2d_set_fill_rgba32(s, 0xFFFFFFFF);
    b2d_path_reset(s);
    b2d_path_from_svg(s, d.ptr, d.len);
    b2d_fill_path(s);

    // Then replace the white fill with effect pixels, modulated by the mask alpha.
    const mask_pixels_const = b2d_get_pixels(s) orelse return;
    const out_pixels: [*]u8 = @constCast(mask_pixels_const);
    var y: u32 = 0;
    while (y < ph) : (y += 1) {
        const src_y = @min(effect_h - 1, (y * effect_h) / ph);
        var x: u32 = 0;
        while (x < pw) : (x += 1) {
            const dst_idx: usize = @as(usize, y) * @as(usize, pw) * 4 + @as(usize, x) * 4;
            const mask_a = out_pixels[dst_idx + 3];
            if (mask_a == 0) {
                out_pixels[dst_idx] = 0;
                out_pixels[dst_idx + 1] = 0;
                out_pixels[dst_idx + 2] = 0;
                out_pixels[dst_idx + 3] = 0;
                continue;
            }

            const src_x = @min(effect_w - 1, (x * effect_w) / pw);
            const src_idx: usize = @as(usize, src_y) * @as(usize, effect_w) * 4 + @as(usize, src_x) * 4;
            const sr = @as(f32, @floatFromInt(effect_pixels[src_idx])) / 255.0;
            const sg = @as(f32, @floatFromInt(effect_pixels[src_idx + 1])) / 255.0;
            const sb = @as(f32, @floatFromInt(effect_pixels[src_idx + 2])) / 255.0;
            const sa = @as(f32, @floatFromInt(effect_pixels[src_idx + 3])) / 255.0;
            const ma = @as(f32, @floatFromInt(mask_a)) / 255.0;
            const out_a = sa * ma * alpha_mul;

            if (out_a <= 0) {
                out_pixels[dst_idx] = 0;
                out_pixels[dst_idx + 1] = 0;
                out_pixels[dst_idx + 2] = 0;
                out_pixels[dst_idx + 3] = 0;
                continue;
            }

            out_pixels[dst_idx] = @intFromFloat(@max(0.0, @min(255.0, sb * out_a * 255.0)));
            out_pixels[dst_idx + 1] = @intFromFloat(@max(0.0, @min(255.0, sg * out_a * 255.0)));
            out_pixels[dst_idx + 2] = @intFromFloat(@max(0.0, @min(255.0, sr * out_a * 255.0)));
            out_pixels[dst_idx + 3] = @intFromFloat(@max(0.0, @min(255.0, out_a * 255.0)));
        }
    }

    if (paisleyDebugEnabled()) {
        var covered: usize = 0;
        var max_a: u8 = 0;
        var i: usize = 0;
        while (i + 3 < @as(usize, pw) * @as(usize, ph) * 4) : (i += 4) {
            const a = out_pixels[i + 3];
            if (a > 0) covered += 1;
            if (a > max_a) max_a = a;
        }
        log.print(
            "[paisley] fillSVGPathFromEffect bbox=({d:.1},{d:.1},{d:.1},{d:.1}) src={d}x{d} raster={d}x{d} covered={d}/{d} max_a={d} stroke_w={d:.2}\n",
            .{ bb_min_x, bb_min_y, bb_w, bb_h, effect_w, effect_h, pw, ph, covered, @as(usize, pw) * @as(usize, ph), max_a, stroke_w },
        );
    }

    if (stroke_w > 0 and stroke_a > 0) {
        b2d_reset_transform(s);
        b2d_scale(s, sx, sy);
        b2d_translate(s, -@as(f64, @floatCast(bb_min_x)), -@as(f64, @floatCast(bb_min_y)));

        const sa: u32 = @intFromFloat(@max(0.0, @min(255.0, stroke_a * alpha_mul * 255.0)));
        const sr: u32 = @intFromFloat(@max(0.0, @min(255.0, stroke_r * 255.0)));
        const sg: u32 = @intFromFloat(@max(0.0, @min(255.0, stroke_g * 255.0)));
        const sb: u32 = @intFromFloat(@max(0.0, @min(255.0, stroke_b * 255.0)));
        const rgba32 = (sa << 24) | (sr << 16) | (sg << 8) | sb;

        b2d_set_stroke_rgba32(s, rgba32);
        b2d_set_stroke_width(s, stroke_w);
        b2d_path_reset(s);
        b2d_path_from_svg(s, d.ptr, d.len);
        b2d_stroke_path(s);
    }

    const slot = ensureTransientFill(pw, ph) orelse return;
    const tex = slot.texture orelse return;
    uploadSurfaceToTexture(tex, pw, ph);
    if (slot.bind_group) |bg| {
        gpu.images.queueQuad(bb_min_x, bb_min_y, bb_w, bb_h, 1.0, bg);
    }
}

/// Clean up all blend2d resources.
pub fn deinit() void {
    for (&g_transient_fills) |*slot| {
        if (slot.bind_group) |bg| bg.release();
        if (slot.texture_view) |tv| tv.release();
        if (slot.texture) |tex| tex.release();
        slot.* = .{};
    }
    if (g_bind_group) |bg| bg.release();
    if (g_texture_view) |v| v.release();
    if (g_texture) |t| t.release();
    if (g_sampler) |s| s.release();
    if (g_surface) |s| b2d_destroy(s);
    g_bind_group = null;
    g_texture_view = null;
    g_texture = null;
    g_sampler = null;
    g_surface = null;
    g_surface_w = 0;
    g_surface_h = 0;
    g_transient_fill_count = 0;
}
