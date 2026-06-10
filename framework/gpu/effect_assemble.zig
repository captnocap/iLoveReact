//! effect_assemble.zig — THE one place an Effect shader is assembled.
//!
//! A cart's WGSL declares only `fs_main`; the full module = a fixed header
//! (Uniforms + `U` binding + `VsOut` + a fullscreen-triangle `vs_main`) + the
//! shared math library (fbm/snoise/voronoi/…) + the cart's recipe. Both the V8
//! host (v8_app, when a `shader` prop becomes an effect) AND the no-V8 material
//! path (gpu/effects.renderShaderToTexture → gpu/material_tex) call assemble()
//! so a shader compiles IDENTICALLY in both — no header drift.
//!
//! Pure string assembly: std + @embedFile only, zero GPU/wgpu deps, so it is
//! safe to import unconditionally (including HEADLESS builds).

const std = @import("std");

// The header must match GpuUniforms in gpu/effects.zig and the vs_main/fs_main
// entry points the effect render pipeline expects.
pub const HEADER: []const u8 =
    \\struct Uniforms {
    \\  size_w: f32,
    \\  size_h: f32,
    \\  time: f32,
    \\  dt: f32,
    \\  frame: f32,
    \\  mouse_x: f32,
    \\  mouse_y: f32,
    \\  mouse_inside: f32,
    \\};
    \\@group(0) @binding(0) var<uniform> U: Uniforms;
    \\
    \\struct VsOut {
    \\  @builtin(position) pos: vec4f,
    \\  @location(0) uv: vec2f,
    \\};
    \\
    \\@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VsOut {
    \\  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    \\  // y=0 → uv.y=1 so the image shader's flip displays "top content" at top.
    \\  let uvs = array<vec2f, 3>(vec2f(0.0, 0.0), vec2f(2.0, 0.0), vec2f(0.0, 2.0));
    \\  var out: VsOut;
    \\  out.pos = vec4f(positions[i], 0.0, 1.0);
    \\  out.uv = uvs[i];
    \\  return out;
    \\}
    \\
;

pub const MATH: []const u8 = @embedFile("effect_math.wgsl");

/// Assemble a complete Effect shader from the cart's `fs_main` recipe. Caller
/// owns the returned buffer. Null only on allocation failure.
pub fn assemble(allocator: std.mem.Allocator, user_wgsl: []const u8) ?[]u8 {
    return std.fmt.allocPrint(allocator, "{s}{s}\n{s}", .{ HEADER, MATH, user_wgsl }) catch null;
}
