//! material_tex.zig — the shared "run a SHADER → a sampleable texture" door.
//!
//! GUIDING_LIGHT: a procedural look travels as its RECIPE (a WGSL shader + a
//! data[] of params), never as baked pixels. This primitive is the host running
//! that recipe ONCE, at load, into a GPU texture — installed under a key that
//! any 3D mesh samples via `scene3d_tex_key`. Hosts (the no-V8 world_loader
//! today; future loaders) call `materialize()` instead of re-rolling the
//! effects→texture→surface plumbing, so the shader-as-material capability lives
//! in exactly ONE place.
//!
//! It is a thin orchestrator over two existing systems: effects.zig compiles +
//! renders the WGSL to a texture (its own command encoder — no frame needed),
//! and gpu.zig installs that texture's view as a keyed StaticSurface entry the
//! 3D pipeline already knows how to sample.

const std = @import("std");
const wgpu = @import("wgpu");
const effects = @import("effects.zig");
const gpu = @import("gpu.zig");

/// Render `wgsl` (+ optional `data` storage params) once into a `size`×`size`
/// texture and install it as the surface keyed `key`, so a mesh with
/// `scene3d_tex_key == key` samples it. Returns false if the GPU isn't ready or
/// the shader won't compile — callers fall back to the face's flat color.
/// Idempotent per (key, shader): re-calling with the same key reuses the cached
/// material instance.
pub fn materialize(io: std.Io, environ: *const std.process.Environ.Map, key: []const u8, wgsl: []const u8, data: ?[]const f32, size: u32) bool {
    const hash = std.hash.Wyhash.hash(0, key);
    const view = effects.renderShaderToTexture(io, environ, hash, wgsl, data, size) orelse return false;
    return gpu.installStaticSurfaceView(key, view, size, size);
}

/// Upload editor-baked PIXELS (RGBA, tight w*4 rows) as the surface keyed
/// `key` — the decal half of the material door (DECALPIX-0610): a decal has
/// no WGSL recipe to run, so the loader installs the pixels the editor baked
/// by execution. Same install path as materialize(), so a mesh with
/// `scene3d_tex_key == key` samples it identically. The texture lives for the
/// process (the same lifetime materialized shader instances have).
pub fn materializePixels(key: []const u8, rgba: []const u8, w: u32, h: u32) bool {
    if (w == 0 or h == 0 or rgba.len != @as(usize, w) * @as(usize, h) * 4) return false;
    const device = gpu.getDevice() orelse return false;
    const queue = gpu.getQueue() orelse return false;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("decal_pixels"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        // Explicit RGBA: the payload's channel order is fixed by the readback
        // door (gpu.readbackStaticSurface swizzles to RGBA) — independent of
        // either app's swapchain format.
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return false;
    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        rgba.ptr,
        rgba.len,
        &.{ .offset = 0, .bytes_per_row = w * 4, .rows_per_image = h },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
    const view = tex.createView(null) orelse {
        tex.release();
        return false;
    };
    if (!gpu.installStaticSurfaceView(key, view, w, h)) {
        view.release();
        tex.release();
        return false;
    }
    return true;
}

/// Render `wgsl`(+`data`) once into a `size`×`size` texture and read it back to CPU
/// RGBA — the "paint bucket": a shader recipe turned into sampleable pixels a brush
/// deposits (paint-with-a-shader). The returned buffer is an 8-byte header (u32 w,
/// u32 h, little-endian) followed by tight w*h*4 RGBA — allocated with
/// `std.heap.page_allocator`; the CALLER frees it. Null if the GPU isn't ready or
/// the shader won't compile. NOTE: the effect instance caches per `key`, so callers
/// that re-bake the SAME shader with different `data` must vary `key` per param set.
///
/// Reads back the effect instance's OWN texture — it must NOT round-trip the
/// static-surface registry (the original shape): materialize() installs only a
/// BORROWED view there, readbackStaticSurface rejects borrowed entries, so that
/// path returned null on every call. It also leaked one registry entry per
/// brush-param tweak. (The white-fill paint bug, req_2482.)
pub fn bakePixels(io: std.Io, environ: *const std.process.Environ.Map, key: []const u8, wgsl: []const u8, data: ?[]const f32, size: u32) ?[]u8 {
    const hash = std.hash.Wyhash.hash(0, key);
    return effects.renderShaderToPixels(io, environ, hash, wgsl, data, size);
}
