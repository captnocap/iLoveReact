//! Vello CPU FFI — Zig bindings for anti-aliased 2D path rendering.
//!
//! Wraps the Rust vello_ffi static library. Provides cached, anti-aliased
//! SVG path fills that upload to GPU textures via the images pipeline.

const std = @import("std");
const gpu = @import("gpu.zig");
const wgpu = @import("wgpu");

// ── C FFI declarations (from deps/vello_ffi) ──────────────────────────

const VelloSurface = opaque {};

extern "c" fn vello_create(width: u32, height: u32) ?*VelloSurface;
extern "c" fn vello_destroy(surface: *VelloSurface) void;
extern "c" fn vello_clear(surface: *VelloSurface) void;
extern "c" fn vello_fill_path(
    surface: *VelloSurface,
    svg_d: [*]const u8, svg_d_len: usize,
    r: f32, g: f32, b: f32, a: f32,
    scale_x: f64, scale_y: f64,
    translate_x: f64, translate_y: f64,
) void;
extern "c" fn vello_stroke_path(
    surface: *VelloSurface,
    svg_d: [*]const u8, svg_d_len: usize,
    r: f32, g: f32, b: f32, a: f32,
    width: f64,
    scale_x: f64, scale_y: f64,
    translate_x: f64, translate_y: f64,
) void;
extern "c" fn vello_render(surface: *VelloSurface) ?[*]const u8;
extern "c" fn vello_width(surface: *const VelloSurface) u32;
extern "c" fn vello_height(surface: *const VelloSurface) u32;

// ── Cached fill textures ──────────────────────────────────────────────

const MAX_FILL_CACHE = 64;

const FillCacheEntry = struct {
    path_ptr: usize = 0,
    color_key: u32 = 0,
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
var g_sampler: ?*wgpu.Sampler = null;

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

/// Fill an SVG path with anti-aliased rendering via Vello CPU.
/// Results are cached — first call rasterizes, subsequent calls reuse the texture.
pub fn fillSVGPath(
    d: []const u8,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    bb_min_x: f32, bb_min_y: f32, bb_w: f32, bb_h: f32,
    pixels_per_unit: f32,
) void {
    if (bb_w <= 0 or bb_h <= 0) return;
    const color_key = packColor(fill_r, fill_g, fill_b, fill_a);

    // Cache hit — reuse existing texture
    if (findCachedFill(@intFromPtr(d.ptr), color_key)) |entry| {
        if (entry.bind_group) |bg| {
            gpu.images.queueQuad(entry.bb_min_x, entry.bb_min_y, entry.bb_w, entry.bb_h, 1.0, bg);
        }
        return;
    }

    // Cache miss — rasterize with Vello
    if (g_fill_cache_count >= MAX_FILL_CACHE) return;
    const ppu: f32 = @max(0.5, pixels_per_unit);
    const pw: u32 = @intFromFloat(@max(1, @min(2048, @ceil(bb_w * ppu))));
    const ph: u32 = @intFromFloat(@max(1, @min(2048, @ceil(bb_h * ppu))));

    const surface = vello_create(pw, ph) orelse return;
    defer vello_destroy(surface);

    // Transform: map graph-space bbox → pixel buffer
    const sx: f64 = @as(f64, @floatFromInt(pw)) / @as(f64, @floatCast(bb_w));
    const sy: f64 = @as(f64, @floatFromInt(ph)) / @as(f64, @floatCast(bb_h));
    const tx: f64 = -@as(f64, @floatCast(bb_min_x));
    const ty: f64 = -@as(f64, @floatCast(bb_min_y));

    vello_fill_path(surface, d.ptr, d.len, fill_r, fill_g, fill_b, fill_a, sx, sy, tx, ty);

    // Render and get pixel buffer
    const pixels = vello_render(surface) orelse return;

    // Upload to GPU texture
    const device = gpu.getDevice() orelse return;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("vello_fill_cache"),
        .size = .{ .width = pw, .height = ph, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = gpu.getFormat(),
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return;
    const tv = tex.createView(null) orelse { tex.release(); return; };
    const queue = gpu.getQueue() orelse { tv.release(); tex.release(); return; };

    // Vello outputs premultiplied RGBA, top-down. Image shader flips Y, so flip rows.
    // Use a stack buffer for row swapping (max row = 4096 * 4 = 16384 bytes)
    const row_bytes: usize = @as(usize, pw) * 4;
    const pixel_mut: [*]u8 = @constCast(pixels);
    if (row_bytes <= 16384 and ph > 1) {
        var tmp: [16384]u8 = undefined;
        var top: usize = 0;
        var bot: usize = @as(usize, ph) - 1;
        while (top < bot) {
            const t_row = pixel_mut[top * row_bytes ..][0..row_bytes];
            const b_row = pixel_mut[bot * row_bytes ..][0..row_bytes];
            @memcpy(tmp[0..row_bytes], t_row);
            @memcpy(t_row, b_row);
            @memcpy(b_row, tmp[0..row_bytes]);
            top += 1;
            bot -= 1;
        }
    }

    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        pixels, pw * ph * 4,
        &.{ .offset = 0, .bytes_per_row = pw * 4, .rows_per_image = ph },
        &.{ .width = pw, .height = ph, .depth_or_array_layers = 1 },
    );

    // Create sampler if needed
    if (g_sampler == null) {
        g_sampler = device.createSampler(&.{
            .address_mode_u = .clamp_to_edge, .address_mode_v = .clamp_to_edge,
            .mag_filter = .linear, .min_filter = .linear,
        });
    }

    const bg = gpu.images.createBindGroup(tv, g_sampler.?) orelse { tv.release(); tex.release(); return; };

    // Store in cache
    const entry = &g_fill_cache[g_fill_cache_count];
    entry.* = .{
        .path_ptr = @intFromPtr(d.ptr),
        .color_key = color_key,
        .bind_group = bg,
        .texture = tex,
        .texture_view = tv,
        .bb_min_x = bb_min_x, .bb_min_y = bb_min_y,
        .bb_w = bb_w, .bb_h = bb_h,
        .active = true,
    };
    g_fill_cache_count += 1;

    // Draw it
    gpu.images.queueQuad(bb_min_x, bb_min_y, bb_w, bb_h, 1.0, bg);
}

/// Release all cached resources.
pub fn deinit() void {
    for (&g_fill_cache) |*entry| {
        if (entry.bind_group) |bg| bg.release();
        if (entry.texture_view) |tv| tv.release();
        if (entry.texture) |tex| tex.release();
        entry.* = .{};
    }
    if (g_sampler) |s| s.release();
    g_sampler = null;
    g_fill_cache_count = 0;
}
