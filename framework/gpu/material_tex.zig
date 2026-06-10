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
const effects = @import("effects.zig");
const gpu = @import("gpu.zig");

/// Render `wgsl` (+ optional `data` storage params) once into a `size`×`size`
/// texture and install it as the surface keyed `key`, so a mesh with
/// `scene3d_tex_key == key` samples it. Returns false if the GPU isn't ready or
/// the shader won't compile — callers fall back to the face's flat color.
/// Idempotent per (key, shader): re-calling with the same key reuses the cached
/// material instance.
pub fn materialize(key: []const u8, wgsl: []const u8, data: ?[]const f32, size: u32) bool {
    const hash = std.hash.Wyhash.hash(0, key);
    const view = effects.renderShaderToTexture(hash, wgsl, data, size) orelse return false;
    return gpu.installStaticSurfaceView(key, view, size, size);
}
