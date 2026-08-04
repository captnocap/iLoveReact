//! WGSL shader source for the tsz wgpu renderer.
//!
//! SDF-based rounded rectangles with borders, anti-aliasing,
//! gradients, and shadows — all in the fragment shader.
//! Glyph atlas text rendering with per-glyph color tinting.
//! SDF quadratic bezier curves with anti-aliased strokes.

const std = @import("std");
const terrain_grid = @import("terrain_grid.zig");

test "scene3d finite atlases alpha-cut signed UV samples while materials can repeat" {
    try std.testing.expect(std.mem.indexOf(u8, scene3d_wgsl, "@group(1) @binding(2) var<uniform> diffuse_sampling: vec4f;") != null);
    try std.testing.expect(std.mem.indexOf(u8, scene3d_wgsl, "let uv_in_bounds = all(in.uv >= vec2f(0.0)) && all(in.uv <= vec2f(1.0));") != null);
    try std.testing.expect(std.mem.indexOf(u8, scene3d_wgsl, "uv_in_bounds || diffuse_sampling.x < 0.5") != null);
}

/// Rect pipeline: instanced fullscreen quads with SDF rounded-rect fragment shader.
/// Each instance is one rectangle with position, size, colors, border-radius, border.
pub const rect_wgsl =
    \\// ── Uniforms ───────────────────────────────────────────────────
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\
    \\// ── Per-instance data ─────────────────────────────────────────
    \\struct RectInstance {
    \\    @location(0) pos: vec2f,         // top-left in screen pixels
    \\    @location(1) size: vec2f,        // width, height in pixels
    \\    @location(2) color: vec4f,       // background RGBA [0..1]
    \\    @location(3) border_color: vec4f,// border RGBA [0..1]
    \\    @location(4) radii: vec4f,       // border-radius: tl, tr, br, bl
    \\    @location(5) border_width: f32,  // border thickness in pixels
    \\    @location(6) rotation: f32,      // degrees
    \\    @location(7) scale_x: f32,
    \\    @location(8) scale_y: f32,
    \\    @location(9) blur_radius: f32,   // SDF shadow blur (0 = sharp)
    \\    @location(10) grad_color: vec4f, // gradient end color RGBA
    \\    @location(11) grad_dir: f32,     // 0=none, 1=vertical, 2=horizontal, 3=diagonal
    \\};
    \\
    \\// ── Vertex output ────────────────────────────────────────────
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) local_pos: vec2f,   // position within rect [0..size]
    \\    @location(1) size: vec2f,
    \\    @location(2) color: vec4f,
    \\    @location(3) border_color: vec4f,
    \\    @location(4) radii: vec4f,
    \\    @location(5) border_width: f32,
    \\    @location(6) blur_radius: f32,
    \\    @location(7) grad_color: vec4f,
    \\    @location(8) grad_dir: f32,
    \\};
    \\
    \\// ── Vertex shader ────────────────────────────────────────────
    \\// 6 vertices per instance (2 triangles = 1 quad), no vertex buffer.
    \\@vertex
    \\fn vs_main(
    \\    @builtin(vertex_index) vertex_index: u32,
    \\    inst: RectInstance,
    \\) -> VertexOutput {
    \\    // Two triangles forming a quad:
    \\    // 0:(0,0) 1:(1,0) 2:(0,1) | 3:(0,1) 4:(1,0) 5:(1,1)
    \\    var quad_x = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
    \\    var quad_y = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
    \\    let uv = vec2f(quad_x[vertex_index], quad_y[vertex_index]);
    \\
    \\    // Expand quad by blur_radius so the soft shadow falloff has pixels to render into
    \\    let pad = inst.blur_radius;
    \\    let padded_size = inst.size + vec2f(pad * 2.0, pad * 2.0);
    \\    let padded_pos = inst.pos - vec2f(pad, pad);
    \\
    \\    // Per-node transform: rotate + scale around rect center
    \\    let center = padded_pos + padded_size * 0.5;
    \\    var local = (uv - 0.5) * padded_size; // offset from center
    \\    // Apply scale
    \\    local = vec2f(local.x * inst.scale_x, local.y * inst.scale_y);
    \\    // Apply rotation (degrees to radians)
    \\    let rad = inst.rotation * 3.14159265 / 180.0;
    \\    let cos_r = cos(rad);
    \\    let sin_r = sin(rad);
    \\    let rotated = vec2f(
    \\        local.x * cos_r - local.y * sin_r,
    \\        local.x * sin_r + local.y * cos_r,
    \\    );
    \\    let pixel_pos = center + rotated;
    \\    let ndc = vec2f(
    \\        pixel_pos.x / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - pixel_pos.y / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VertexOutput;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    // local_pos is relative to the ORIGINAL rect (not padded), offset by pad
    \\    out.local_pos = uv * padded_size - vec2f(pad, pad);
    \\    out.size = inst.size;
    \\    out.color = inst.color;
    \\    out.border_color = inst.border_color;
    \\    out.radii = inst.radii;
    \\    out.border_width = inst.border_width;
    \\    out.blur_radius = inst.blur_radius;
    \\    out.grad_color = inst.grad_color;
    \\    out.grad_dir = inst.grad_dir;
    \\    return out;
    \\}
    \\
    \\// ── SDF rounded rectangle ────────────────────────────────────
    \\fn sdf_rounded_rect(p: vec2f, half_size: vec2f, radii: vec4f) -> f32 {
    \\    // radii: tl, tr, br, bl
    \\    // Cap each corner to the short edge. Without this, a pill-style
    \\    // `borderRadius: 999` on a 24px-tall button pushes q = abs(p) -
    \\    // half_size + r positive even at the rect's CENTER, which
    \\    // inverts the SDF and renders a torn / blown-out interior. Cap
    \\    // before quadrant-selection so EVERY corner is bounded.
    \\    let r_max = max(min(half_size.x, half_size.y), 0.0);
    \\    let clamped = min(max(radii, vec4f(0.0)), vec4f(r_max));
    \\    let r_top = select(clamped.x, clamped.y, p.x > 0.0);
    \\    let r_bot = select(clamped.w, clamped.z, p.x > 0.0);
    \\    let r = select(r_top, r_bot, p.y > 0.0);
    \\    let q = abs(p) - half_size + r;
    \\    return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
    \\}
    \\
    \\// ── Fragment shader ───────────────────────────────────────────
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let half_size = in.size * 0.5;
    \\    let p = in.local_pos - half_size; // center-relative coords
    \\
    \\    let dist = sdf_rounded_rect(p, half_size, in.radii);
    \\
    \\    // Shadow mode: blur_radius > 0 uses wide SDF falloff
    \\    // dist < 0 = inside rect, dist > 0 = outside rect
    \\    // Shadow fades from full opacity at the edge to zero at blur_radius beyond
    \\    if in.blur_radius > 0.0 {
    \\        let shadow_aa = 1.0 - smoothstep(0.0, in.blur_radius, dist);
    \\        if shadow_aa <= 0.0 { discard; }
    \\        let final_a = in.color.a * shadow_aa;
    \\        return vec4f(in.color.rgb * final_a, final_a);
    \\    }
    \\
    \\    // Normal mode: anti-aliased edge (~1px smooth falloff).
    \\    //
    \\    // The inner edge of the AA band is clamped to -min(half_size, 1.0)
    \\    // so the smoothstep never bleeds further inside than the rect's
    \\    // half-width. Without this, sub-2px rects (e.g. 1×1 cells in a pixel
    \\    // grid) have their entire interior fall inside the AA falloff and
    \\    // render at ~50-75% opacity at the brightest point.
    \\    let inner_edge = -min(min(half_size.x, half_size.y), 1.0);
    \\    let aa = 1.0 - smoothstep(inner_edge, 0.5, dist);
    \\
    \\    if aa <= 0.0 {
    \\        discard;
    \\    }
    \\
    \\    // Gradient: mix start color → end color based on direction
    \\    var base_color = in.color;
    \\    if in.grad_dir > 0.0 {
    \\        let uv = in.local_pos / in.size; // [0..1] within rect
    \\        var t: f32 = 0.0;
    \\        if in.grad_dir < 1.5 {
    \\            t = uv.y;  // vertical: top→bottom
    \\        } else if in.grad_dir < 2.5 {
    \\            t = uv.x;  // horizontal: left→right
    \\        } else {
    \\            t = (uv.x + uv.y) * 0.5;  // diagonal
    \\        }
    \\        base_color = mix(in.color, in.grad_color, t);
    \\    }
    \\
    \\    // Border: if border_width > 0, inner region is fill, outer ring is border
    \\    var final_color: vec4f;
    \\    if in.border_width > 0.0 {
    \\        let bw = in.border_width;
    \\        let inner_half = max(half_size - vec2f(bw, bw), vec2f(0.0, 0.0));
    \\        let inner_radii = max(in.radii - vec4f(bw, bw, bw, bw), vec4f(0.0, 0.0, 0.0, 0.0));
    \\        let inner_dist = sdf_rounded_rect(p, inner_half, inner_radii);
    \\        let inner_aa = smoothstep(-1.0, 0.5, inner_dist);
    \\        // mix: inner_aa=0 means inside fill, inner_aa=1 means in border zone
    \\        final_color = mix(base_color, in.border_color, inner_aa);
    \\    } else {
    \\        final_color = base_color;
    \\    }
    \\
    \\    // Apply edge anti-aliasing
    \\    final_color.a *= aa;
    \\
    \\    // Premultiply alpha for correct blending
    \\    return vec4f(final_color.rgb * final_color.a, final_color.a);
    \\}
;

/// Text pipeline: instanced textured quads sampling from a glyph atlas.
/// Each instance is one glyph with screen position, atlas UV, and color.
pub const text_wgsl =
    \\// ── Uniforms ───────────────────────────────────────────────────
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\@group(0) @binding(1) var atlas_tex: texture_2d<f32>;
    \\@group(0) @binding(2) var atlas_sampler: sampler;
    \\
    \\// ── Per-instance data ─────────────────────────────────────────
    \\struct GlyphInstance {
    \\    @location(0) pos: vec2f,     // screen position (top-left)
    \\    @location(1) size: vec2f,    // glyph size on screen
    \\    @location(2) uv_pos: vec2f,  // atlas UV offset [0..1]
    \\    @location(3) uv_size: vec2f, // atlas UV extent [0..1]
    \\    @location(4) color: vec4f,   // text color RGBA
    \\    @location(5) m_abcd: vec4f,  // 2x2 linear part of CSS transform: (a,b,c,d)
    \\    @location(6) m_txy:  vec2f,  // translation of CSS transform: (tx, ty)
    \\};
    \\
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) uv: vec2f,
    \\    @location(1) color: vec4f,
    \\};
    \\
    \\@vertex
    \\fn vs_main(
    \\    @builtin(vertex_index) vertex_index: u32,
    \\    inst: GlyphInstance,
    \\) -> VertexOutput {
    \\    var quad_x = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
    \\    var quad_y = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
    \\    let corner = vec2f(quad_x[vertex_index], quad_y[vertex_index]);
    \\
    \\    // Unrotated corner in screen pixels (canvas pan/zoom already applied
    \\    // CPU-side). Then apply the per-glyph 2D affine matrix — identity by
    \\    // default, set when a CSS transform is active on an ancestor.
    \\    let local = inst.pos + corner * inst.size;
    \\    let pixel_pos = vec2f(
    \\        inst.m_abcd.x * local.x + inst.m_abcd.z * local.y + inst.m_txy.x,
    \\        inst.m_abcd.y * local.x + inst.m_abcd.w * local.y + inst.m_txy.y,
    \\    );
    \\    let ndc = vec2f(
    \\        pixel_pos.x / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - pixel_pos.y / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VertexOutput;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    out.uv = inst.uv_pos + corner * inst.uv_size;
    \\    out.color = inst.color;
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let atlas_sample = textureSample(atlas_tex, atlas_sampler, in.uv);
    \\    // Atlas stores white glyphs with alpha — tint with text color
    \\    let alpha = atlas_sample.a * in.color.a;
    \\    if alpha <= 0.0 {
    \\        discard;
    \\    }
    \\    let rgb = in.color.rgb * alpha;
    \\    return vec4f(rgb, alpha);
    \\}
;

/// SDF icon pipeline: pre-baked unsigned distance field atlas + smoothstep'd
/// fragment thresholding. One instanced quad per icon. The atlas (R8Unorm)
/// stores `byte = clamp(255 * (1 - dist/SPREAD), 0, 255)` so byte 128 is the
/// shape edge — `smoothstep(0.5 - aa, 0.5 + aa, sample)` gives crisp anti-
/// aliased stroke at any rendering size. `fwidth(sample)` adapts the AA band
/// to screen-space derivative — that's the sleight of hand that lets a tiny
/// 32×32 atlas tile render perfectly at 16 px or 256 px without re-baking.
pub const sdf_icon_wgsl =
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\@group(0) @binding(1) var atlas_tex: texture_2d<f32>;
    \\@group(0) @binding(2) var atlas_sampler: sampler;
    \\
    \\struct IconInstance {
    \\    @location(0) pos: vec2f,        // top-left in screen pixels (transform-applied)
    \\    @location(1) size: vec2f,       // width, height in pixels
    \\    @location(2) uv_pos: vec2f,     // atlas UV offset [0..1]
    \\    @location(3) uv_size: vec2f,    // atlas UV extent [0..1]
    \\    @location(4) color: vec4f,      // tint RGBA — fully opaque stroke color
    \\    @location(5) edge_smooth: vec2f,// edge midpoint (default 0.5) + extra AA
    \\};
    \\
    \\struct VsOut {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) uv: vec2f,
    \\    @location(1) color: vec4f,
    \\    @location(2) edge_smooth: vec2f,
    \\};
    \\
    \\@vertex
    \\fn vs_main(@builtin(vertex_index) idx: u32, inst: IconInstance) -> VsOut {
    \\    var quad_x = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
    \\    var quad_y = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
    \\    let corner = vec2f(quad_x[idx], quad_y[idx]);
    \\
    \\    let pixel_pos = inst.pos + corner * inst.size;
    \\    let ndc = vec2f(
    \\        pixel_pos.x / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - pixel_pos.y / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VsOut;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    out.uv = inst.uv_pos + corner * inst.uv_size;
    \\    out.color = inst.color;
    \\    out.edge_smooth = inst.edge_smooth;
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VsOut) -> @location(0) vec4f {
    \\    // Sample the SDF byte. R8Unorm gives us [0..1] in .r — closer to 1
    \\    // means closer to a stroke pixel; closer to 0 means far away.
    \\    let d = textureSample(atlas_tex, atlas_sampler, in.uv).r;
    \\    // Screen-space adaptive AA band — fwidth picks up the per-pixel
    \\    // change in the SDF sample, scaling the smoothstep edge so it stays
    \\    // ~1 fragment wide regardless of how small or large the icon renders.
    \\    let aa = max(fwidth(d) * 0.7 + in.edge_smooth.y, 0.001);
    \\    let edge = in.edge_smooth.x;
    \\    let alpha = smoothstep(edge - aa, edge + aa, d) * in.color.a;
    \\    if alpha <= 0.001 { discard; }
    \\    // Pre-multiplied output to match the rest of the pipeline's blend mode.
    \\    return vec4f(in.color.rgb * alpha, alpha);
    \\}
;

/// G-curve fill pipeline: Loop-Blinn-style filled quadratic bezier triangles.
/// Per-vertex barycentric coords drive a per-pixel `u*u - v < 0` interior
/// test. Smoothstep on `fwidth(...)` of that gives sub-pixel-perfect AA at
/// any zoom — the speaker's "the GPU only understands triangles, give it
/// triangles with bezier weights" recipe applied as an authoring primitive.
/// Each instance = ONE triangle (3 vertices); the vertex shader emits the
/// three corners with hard-coded bezier UVs (0,0), (0.5,0), (1,1).
pub const gcurve_fill_wgsl =
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\
    \\struct GCurveInstance {
    \\    @location(0) p0: vec2f,    // start point (curve passes through)
    \\    @location(1) p1: vec2f,    // off-curve control point
    \\    @location(2) p2: vec2f,    // end point (curve passes through)
    \\    @location(3) color: vec4f, // straight RGBA — premultiplied at output
    \\};
    \\
    \\struct VsOut {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) bezier_uv: vec2f,
    \\    @location(1) color: vec4f,
    \\};
    \\
    \\@vertex
    \\fn vs_main(@builtin(vertex_index) idx: u32, inst: GCurveInstance) -> VsOut {
    \\    // Three corners of the triangle, plus the bezier UVs that drive
    \\    // the fragment's interior test. v0 = (0,0), v1 = (0.5,0), v2 = (1,1)
    \\    // is the canonical Loop-Blinn assignment so that f(u,v) = u*u - v
    \\    // crosses zero exactly along the curve passing through p0 and p2
    \\    // with control p1.
    \\    var px: f32 = 0.0;
    \\    var py: f32 = 0.0;
    \\    var uv: vec2f = vec2f(0.0, 0.0);
    \\    if (idx == 0u) {
    \\        px = inst.p0.x; py = inst.p0.y;
    \\        uv = vec2f(0.0, 0.0);
    \\    } else if (idx == 1u) {
    \\        px = inst.p1.x; py = inst.p1.y;
    \\        uv = vec2f(0.5, 0.0);
    \\    } else {
    \\        px = inst.p2.x; py = inst.p2.y;
    \\        uv = vec2f(1.0, 1.0);
    \\    }
    \\
    \\    let ndc = vec2f(
    \\        px / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - py / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VsOut;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    out.bezier_uv = uv;
    \\    out.color = inst.color;
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VsOut) -> @location(0) vec4f {
    \\    // Loop-Blinn implicit form: the curve is the locus where u² - v = 0.
    \\    // Inside the curve region of the triangle: u² - v < 0. Outside: > 0.
    \\    let f = in.bezier_uv.x * in.bezier_uv.x - in.bezier_uv.y;
    \\    // Screen-space adaptive AA — fwidth picks up the per-fragment change
    \\    // in f, so the smoothstep edge stays ~1 pixel wide regardless of how
    \\    // big or small the triangle renders. This is what makes the curve
    \\    // crisp at any zoom level with no SDF texture in sight.
    \\    let aa = fwidth(f);
    \\    let alpha = (1.0 - smoothstep(-aa, aa, f)) * in.color.a;
    \\    if alpha <= 0.001 { discard; }
    \\    return vec4f(in.color.rgb * alpha, alpha);
    \\}
;

/// Curve pipeline: SDF quadratic bezier strokes.
/// Each instance is one quadratic bezier segment (3 control points).
/// Cubics are split into 2-3 quadratics on the CPU side.
/// The fragment shader computes exact signed distance to the curve.
pub const curve_wgsl =
    \\// ── Uniforms ───────────────────────────────────────────────────
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\
    \\// ── Per-instance data ─────────────────────────────────────────
    \\// 32-byte row (curves.zig CurveInstance) — color arrives unorm8x4,
    \\// already widened to vec4f by the vertex fetch.
    \\struct CurveInstance {
    \\    @location(0) p0: vec2f,           // start point (screen pixels)
    \\    @location(1) p1: vec2f,           // control point
    \\    @location(2) p2: vec2f,           // end point
    \\    @location(3) color: vec4f,        // stroke RGBA [0..1]
    \\    @location(4) stroke_width: f32,   // stroke thickness in pixels
    \\};
    \\
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) pixel_pos: vec2f,    // screen-space pixel position
    \\    @location(1) p0: vec2f,
    \\    @location(2) p1: vec2f,
    \\    @location(3) p2: vec2f,
    \\    @location(4) color: vec4f,
    \\    @location(5) stroke_width: f32,
    \\};
    \\
    \\// ── Vertex shader ────────────────────────────────────────────
    \\// Emit a bounding quad that encloses the curve + stroke padding.
    \\@vertex
    \\fn vs_main(
    \\    @builtin(vertex_index) vertex_index: u32,
    \\    inst: CurveInstance,
    \\) -> VertexOutput {
    \\    // Bounding box of all 3 control points
    \\    let bbox_min = min(min(inst.p0, inst.p1), inst.p2);
    \\    let bbox_max = max(max(inst.p0, inst.p1), inst.p2);
    \\
    \\    // Expand by stroke width + 2px for anti-aliasing
    \\    let pad = inst.stroke_width * 0.5 + 2.0;
    \\    let box_min = bbox_min - pad;
    \\    let box_max = bbox_max + pad;
    \\    let box_size = box_max - box_min;
    \\
    \\    var quad_x = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
    \\    var quad_y = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
    \\    let uv = vec2f(quad_x[vertex_index], quad_y[vertex_index]);
    \\
    \\    let pixel_pos = box_min + uv * box_size;
    \\    let ndc = vec2f(
    \\        pixel_pos.x / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - pixel_pos.y / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VertexOutput;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    out.pixel_pos = pixel_pos;
    \\    out.p0 = inst.p0;
    \\    out.p1 = inst.p1;
    \\    out.p2 = inst.p2;
    \\    out.color = inst.color;
    \\    out.stroke_width = inst.stroke_width;
    \\    return out;
    \\}
    \\
    \\// ── SDF distance + closest t for quadratic bezier ──────────
    \\// Returns vec2f(distance, closest_t).
    \\// Based on Inigo Quilez's approach: solve the cubic for closest t.
    \\fn sdf_bezier_t(pos: vec2f, a: vec2f, b: vec2f, c: vec2f) -> vec2f {
    \\    let A = b - a;
    \\    let B = c - 2.0 * b + a;
    \\    let C = a - pos;
    \\
    \\    let k3 = dot(B, B);
    \\    let k2 = 3.0 * dot(A, B);
    \\    let k1 = 2.0 * dot(A, A) + dot(C, B);
    \\    let k0 = dot(C, A);
    \\
    \\    var min_dist = 1e10;
    \\    var best_t = 0.0;
    \\
    \\    // Check endpoints
    \\    let d0 = dot(C, C);
    \\    let end_v = a + 2.0 * A + B - pos;
    \\    let d1 = dot(end_v, end_v);
    \\    if d0 < d1 { min_dist = d0; best_t = 0.0; }
    \\    else { min_dist = d1; best_t = 1.0; }
    \\
    \\    // Solve cubic for interior critical points
    \\    if abs(k3) > 1e-6 {
    \\        let ik3 = 1.0 / k3;
    \\        let p_coeff = (3.0 * k1 * k3 - k2 * k2) / (3.0 * k3 * k3);
    \\        let q_coeff = (2.0 * k2 * k2 * k2 - 9.0 * k1 * k2 * k3 + 27.0 * k0 * k3 * k3) / (27.0 * k3 * k3 * k3);
    \\        let disc = q_coeff * q_coeff / 4.0 + p_coeff * p_coeff * p_coeff / 27.0;
    \\        let shift = -k2 * ik3 / 3.0;
    \\
    \\        if disc >= 0.0 {
    \\            let sq = sqrt(disc);
    \\            let u = sign(-q_coeff * 0.5 + sq) * pow(abs(-q_coeff * 0.5 + sq), 1.0 / 3.0);
    \\            let v = sign(-q_coeff * 0.5 - sq) * pow(abs(-q_coeff * 0.5 - sq), 1.0 / 3.0);
    \\            let t0 = clamp(u + v + shift, 0.0, 1.0);
    \\            let pt0 = a + 2.0 * A * t0 + B * t0 * t0 - pos;
    \\            let dd = dot(pt0, pt0);
    \\            if dd < min_dist { min_dist = dd; best_t = t0; }
    \\        } else {
    \\            let mp3 = -p_coeff / 3.0;
    \\            let r = sqrt(mp3 * mp3 * mp3);
    \\            let cos_phi = clamp(-q_coeff / (2.0 * r), -1.0, 1.0);
    \\            let phi = acos(cos_phi) / 3.0;
    \\            let cube_r = pow(r, 1.0 / 3.0) * 2.0;
    \\            let t0 = clamp(cube_r * cos(phi) + shift, 0.0, 1.0);
    \\            let t1 = clamp(cube_r * cos(phi - 2.094395) + shift, 0.0, 1.0);
    \\            let t2 = clamp(cube_r * cos(phi - 4.188790) + shift, 0.0, 1.0);
    \\            let pt0 = a + 2.0 * A * t0 + B * t0 * t0 - pos;
    \\            let pt1 = a + 2.0 * A * t1 + B * t1 * t1 - pos;
    \\            let pt2 = a + 2.0 * A * t2 + B * t2 * t2 - pos;
    \\            let dd0 = dot(pt0, pt0);
    \\            let dd1 = dot(pt1, pt1);
    \\            let dd2 = dot(pt2, pt2);
    \\            if dd0 < min_dist { min_dist = dd0; best_t = t0; }
    \\            if dd1 < min_dist { min_dist = dd1; best_t = t1; }
    \\            if dd2 < min_dist { min_dist = dd2; best_t = t2; }
    \\        }
    \\    } else if abs(k2) > 1e-6 {
    \\        let det = k1 * k1 - 4.0 * k0 * k2;
    \\        if det >= 0.0 {
    \\            let sq = sqrt(det);
    \\            let ta = clamp((-k1 + sq) / (2.0 * k2), 0.0, 1.0);
    \\            let tb = clamp((-k1 - sq) / (2.0 * k2), 0.0, 1.0);
    \\            let pa = a + 2.0 * A * ta + B * ta * ta - pos;
    \\            let pb = a + 2.0 * A * tb + B * tb * tb - pos;
    \\            let da = dot(pa, pa);
    \\            let db = dot(pb, pb);
    \\            if da < min_dist { min_dist = da; best_t = ta; }
    \\            if db < min_dist { min_dist = db; best_t = tb; }
    \\        }
    \\    } else if abs(k1) > 1e-6 {
    \\        let t0 = clamp(-k0 / k1, 0.0, 1.0);
    \\        let pt0 = a + 2.0 * A * t0 + B * t0 * t0 - pos;
    \\        let dd = dot(pt0, pt0);
    \\        if dd < min_dist { min_dist = dd; best_t = t0; }
    \\    }
    \\
    \\    return vec2f(sqrt(min_dist), best_t);
    \\}
    \\
    \\// ── Fragment shader ───────────────────────────────────────────
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let result = sdf_bezier_t(in.pixel_pos, in.p0, in.p1, in.p2);
    \\    let dist = result.x;
    \\    let half_w = in.stroke_width * 0.5;
    \\
    \\    // Anti-aliased stroke: smooth falloff over 1px at the edge
    \\    let alpha = 1.0 - smoothstep(half_w - 1.0, half_w + 0.5, dist);
    \\
    \\    if alpha <= 0.0 {
    \\        discard;
    \\    }
    \\
    \\    let final_alpha = in.color.a * alpha;
    \\
    \\    if final_alpha <= 0.001 {
    \\        discard;
    \\    }
    \\
    \\    return vec4f(in.color.rgb * final_alpha, final_alpha);
    \\}
;

/// Capsule pipeline: SDF line segments with round caps.
/// Each instance is one segment (p0, p1) with a stroke width. The fragment
/// shader computes distance to the segment; fragments past an endpoint
/// measure distance to that endpoint, producing a semicircular cap.
///
/// Round joins are free: two capsules sharing an endpoint each contribute
/// their own semicircle at that point, and the union is a disc that covers
/// the outside wedge of any turn angle without any join geometry on the CPU.
pub const capsule_wgsl =
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\
    \\// 24-byte row (capsules.zig CapsuleInstance) — color arrives unorm8x4,
    \\// already widened to vec4f by the vertex fetch.
    \\struct CapsuleInstance {
    \\    @location(0) p0: vec2f,
    \\    @location(1) p1: vec2f,
    \\    @location(2) color: vec4f,
    \\    @location(3) stroke_width: f32,
    \\};
    \\
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) pixel_pos: vec2f,
    \\    @location(1) p0: vec2f,
    \\    @location(2) p1: vec2f,
    \\    @location(3) color: vec4f,
    \\    @location(4) stroke_width: f32,
    \\};
    \\
    \\@vertex
    \\fn vs_main(
    \\    @builtin(vertex_index) vertex_index: u32,
    \\    inst: CapsuleInstance,
    \\) -> VertexOutput {
    \\    // Bounding box: encloses both endpoints, padded by width/2 (so
    \\    // round caps have room to render) plus 2px for anti-aliasing.
    \\    let bbox_min = min(inst.p0, inst.p1);
    \\    let bbox_max = max(inst.p0, inst.p1);
    \\    let pad = inst.stroke_width * 0.5 + 2.0;
    \\    let box_min = bbox_min - pad;
    \\    let box_max = bbox_max + pad;
    \\    let box_size = box_max - box_min;
    \\
    \\    var quad_x = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
    \\    var quad_y = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
    \\    let uv = vec2f(quad_x[vertex_index], quad_y[vertex_index]);
    \\
    \\    let pixel_pos = box_min + uv * box_size;
    \\    let ndc = vec2f(
    \\        pixel_pos.x / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - pixel_pos.y / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VertexOutput;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    out.pixel_pos = pixel_pos;
    \\    out.p0 = inst.p0;
    \\    out.p1 = inst.p1;
    \\    out.color = inst.color;
    \\    out.stroke_width = inst.stroke_width;
    \\    return out;
    \\}
    \\
    \\// Distance from point p to the capsule skeleton (segment a→b).
    \\// Past either endpoint, clamps to endpoint → returns endpoint
    \\// distance → becomes a round cap after the smoothstep. A zero-length
    \\// segment (a == b) falls through cleanly because the clamp pins h=0
    \\// and length(p - a) is still the distance to the single point.
    \\fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    \\    let pa = p - a;
    \\    let ba = b - a;
    \\    let ba_len2 = max(dot(ba, ba), 1e-8);
    \\    let h = clamp(dot(pa, ba) / ba_len2, 0.0, 1.0);
    \\    return length(pa - ba * h);
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let dist = sd_segment(in.pixel_pos, in.p0, in.p1);
    \\    let half_w = in.stroke_width * 0.5;
    \\    let alpha = 1.0 - smoothstep(half_w - 1.0, half_w + 0.5, dist);
    \\    if alpha <= 0.0 { discard; }
    \\    let final_alpha = in.color.a * alpha;
    \\    return vec4f(in.color.rgb * final_alpha, final_alpha);
    \\}
;

/// Image pipeline: textured quads for video frames and images.
/// Each instance is one quad with screen position, size, and opacity.
/// The texture is bound per-draw-call (each image has its own bind group).
pub const image_wgsl =
    \\// ── Uniforms ───────────────────────────────────────────────────
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\@group(0) @binding(1) var image_tex: texture_2d<f32>;
    \\@group(0) @binding(2) var image_sampler: sampler;
    \\
    \\// ── Per-instance data ─────────────────────────────────────────
    \\struct ImageInstance {
    \\    @location(0) pos: vec2f,
    \\    @location(1) size: vec2f,
    \\    @location(2) opacity: f32,
    \\    @location(3) no_flip_y: f32,
    \\};
    \\
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) uv: vec2f,
    \\    @location(1) opacity: f32,
    \\};
    \\
    \\@vertex
    \\fn vs_main(
    \\    @builtin(vertex_index) vertex_index: u32,
    \\    inst: ImageInstance,
    \\) -> VertexOutput {
    \\    var quad_x = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
    \\    var quad_y = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
    \\    let corner = vec2f(quad_x[vertex_index], quad_y[vertex_index]);
    \\
    \\    let pixel_pos = inst.pos + corner * inst.size;
    \\    let ndc = vec2f(
    \\        pixel_pos.x / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - pixel_pos.y / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VertexOutput;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    let uv_y = select(1.0 - corner.y, corner.y, inst.no_flip_y > 0.5);
    \\    out.uv = vec2f(corner.x, uv_y); // default flip: GL/readback images are bottom-up
    \\    out.opacity = inst.opacity;
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let color = textureSample(image_tex, image_sampler, in.uv);
    \\    // Standard premultiplied-alpha compositing for all textured quads.
    \\    // Video sources must upload explicit alpha instead of relying on
    \\    // alpha==0 sentinel behavior, otherwise transparent textures such as
    \\    // masked Graph.Path fills turn into opaque bbox tiles.
    \\    let alpha = color.a * in.opacity;
    \\    if alpha <= 0.0 {
    \\        discard;
    \\    }
    \\    return vec4f(color.rgb * in.opacity, alpha);
    \\}
;

/// Decode the snorm16x2 octahedral vertex normal of the 20-byte packed Vertex
/// (encode side: pack.octEncodeSnorm16 — keep in lockstep). Prepended to every
/// shader that reads vbuf0's noct; WGSL module declarations are order-free.
const oct_decode_wgsl =
    \\fn oct_decode(e: vec2f) -> vec3f {
    \\    var n = vec3f(e.xy, 1.0 - abs(e.x) - abs(e.y));
    \\    if n.z < 0.0 {
    \\        let fx = (1.0 - abs(n.y)) * select(-1.0, 1.0, n.x >= 0.0);
    \\        let fy = (1.0 - abs(n.x)) * select(-1.0, 1.0, n.y >= 0.0);
    \\        n = vec3f(fx, fy, n.z);
    \\    }
    \\    return normalize(n);
    \\}
    \\
;

/// 3D mesh pipeline: perspective projection + Blinn-Phong lighting.
/// Vertex: position f32x3 + oct normal snorm16x2 + uv f16x2 = 20 bytes (3d.zig Vertex).
/// Uniforms: MVP, model matrix, lighting, material color.
/// Assembled below from shared chunks (decls / vertex input / common / vs / fs)
/// so the SKINNED variant reuses everything except its vertex stage — the
/// fragment shader and the packed-instance model rebuild can never drift
/// between the two.
const scene3d_decls =
    \\// ── Scene-wide uniforms (one set per frame, no dynamic offset) ──
    \\struct SceneUniforms {
    \\    vp: mat4x4f,
    \\    light_dir: vec3f,
    \\    specular_power: f32,
    \\    light_color: vec3f,
    \\    light_count: f32,
    \\    ambient_color: vec3f,
    \\    _pad2: f32,
    \\    camera_pos: vec3f,
    \\    time: f32,      // 124 — wrapped wall-clock the host writes each frame (was _pad3); animated ground/foliage materials read S.time
    \\    fog_color: vec3f,
    \\    fog_near: f32,
    \\    fog_far: f32,
    \\    fog_sky: f32,
    \\    wire: f32,      // 152 — wireframe flag in the shared scene uniform buffer; only scene3d_wgsl reads it (was _pad4a)
    \\    matcap: f32,    // 156 — shade by view-space normal, req_3766; only scene3d_wgsl reads it (was _pad4b)
    \\    sky_horizon: vec3f,
    \\    _pad5: f32,
    \\    sky_zenith: vec4f,
    \\};
    \\// One placed light = the user's "pyramid": a tip (pos) that throws light down
    \\// `dir`, opening to a cone (cos_outer..cos_inner) and carrying `range`. An omni
    \\// bulb is the pyramid opened all the way — cos_outer = -1 (cos 180°). std430:
    \\// every vec3 already lands 16-aligned, so the Zig `Light` struct copies byte-
    \\// for-byte (3d.zig comptime-asserts 64 bytes).
    \\struct Light {
    \\    pos: vec3f,
    \\    range: f32,
    \\    dir: vec3f,
    \\    cos_outer: f32,
    \\    color: vec3f,
    \\    intensity: f32,
    \\    cos_inner: f32,
    \\    kind: f32,
    \\    _a: f32,
    \\    _b: f32,
    \\};
    \\// Shadow of ONE caster (a spotlight): its light-space view-projection plus the
    \\// knobs to sample its depth map. has_shadow == 0 → the map is a dummy and the
    \\// visibility test short-circuits to 1 (fully lit). caster_index picks which
    \\// placed light the map belongs to, so only that light is occluded.
    \\struct ShadowUniforms {
    \\    light_vp: mat4x4f,
    \\    has_shadow: f32,
    \\    caster_index: f32,
    \\    bias: f32,
    \\    texel: f32,
    \\};
    \\@group(0) @binding(0) var<uniform> S: SceneUniforms;
    \\@group(0) @binding(1) var<storage, read> lights: array<Light>;
    \\@group(0) @binding(2) var<uniform> SH: ShadowUniforms;
    \\@group(0) @binding(3) var shadow_tex: texture_depth_2d;
    \\@group(0) @binding(4) var shadow_smp: sampler_comparison;
    \\@group(1) @binding(0) var diffuse_tex: texture_2d<f32>;
    \\@group(1) @binding(1) var diffuse_smp: sampler;
    \\// x == 1 means this diffuse is a finite model atlas: sampling beyond its
    \\// rectangle contributes zero alpha. x == 0 preserves material tiling.
    \\@group(1) @binding(2) var<uniform> diffuse_sampling: vec4f;
    \\
;

// The standard (non-skinned) VertexInput — locations 0–2 per-vertex from vbuf0,
// 3–6 per-instance from vbuf1. Split from the shared decls so the skinned
// variant can extend it with joint/weight attributes at locations 7–8.
const scene3d_vs_input =
    \\// ── Vertex I/O ────────────────────────────────────────────────
    \\// Per-vertex attrs at locations 0–2 come from vertex buffer 0 (the retained
    \\// geometry, step=vertex). Per-instance attrs at locations 3–7 come from
    \\// vertex buffer 1 (the per-frame instance buffer, step=instance): model
    \\// matrix as 4 vec4 columns + inst_color. drawScene packs the per-instance
    \\// bytes per (geom_key, texture) group and issues ONE instanced draw per
    \\// group — the N→1 draw-call collapse.
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_euler: vec4u,   // rx, ry, rz (u16 deg ring) + pad
    \\    @location(5) inst_scale: vec4f,   // sx, sy, sz (f16 m) + pad
    \\    @location(6) inst_color: vec4f,   // rgba (unorm8)
    \\};
    \\
;

// Shared between the standard and skinned variants: VertexOutput, the packed-
// instance model matrix rebuild, and the shadow-visibility sampler.
const scene3d_common =
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) world_pos: vec3f,
    \\    @location(1) world_normal: vec3f,
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_color: vec4f,
    \\    // Screen-space NDC.y (linear so it matches the screen-space sky gradient).
    \\    @location(4) @interpolate(linear) screen_y: f32,
    \\    // Barycentric coords of this vertex within its triangle (1,0,0)/(0,1,0)/
    \\    // (0,0,1), derived from vertex_index%3. Interpolated, it gives each fragment
    \\    // its distance to the nearest edge — the basis for the wireframe overlay.
    \\    @location(5) bary: vec3f,
    \\};
    \\
    \\// Rebuild the model matrix from the packed instance (32-byte InstanceData):
    \\// position f32x3, euler u16x4 (deg ring), scale f16x4, rgba u8x4. Column-major
    \\// here = makeInstance's row-major T·Ry·Rx·Rz·S after its transpose. MUST match.
    \\fn rebuild_model(inst_pos: vec3f, inst_euler: vec4u, inst_scale: vec4f) -> mat4x4f {
    \\    let a = 360.0 / 65536.0 * 0.017453292;
    \\    let rot = vec3f(f32(inst_euler.x), f32(inst_euler.y), f32(inst_euler.z)) * a;
    \\    let s = inst_scale.xyz;
    \\    let crx = cos(rot.x); let srx = sin(rot.x);
    \\    let cry = cos(rot.y); let sry = sin(rot.y);
    \\    let crz = cos(rot.z); let srz = sin(rot.z);
    \\    let mS  = mat4x4f(vec4f(s.x,0,0,0), vec4f(0,s.y,0,0), vec4f(0,0,s.z,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,crx,srx,0), vec4f(0,-srx,crx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cry,0,-sry,0), vec4f(0,1,0,0), vec4f(sry,0,cry,0), vec4f(0,0,0,1));
    \\    let mRz = mat4x4f(vec4f(crz,srz,0,0), vec4f(-srz,crz,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
    \\    let mT  = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(inst_pos,1));
    \\    return mT * mRy * mRx * mRz * mS;
    \\}
    \\
    \\// Shadow visibility at a world point: 1 = lit, 0 = fully shadowed. Project into
    \\// the caster's light space, sample its depth map with a 3×3 PCF kernel (soft
    \\// rim). Outside the map / behind the far plane → lit (the cone falloff already
    \\// bounds the lit region). Uses textureSampleCompareLevel (mip 0, no derivatives)
    \\// so the non-uniform early-outs are legal. Applied to just the caster light below.
    \\fn shadow_vis(world_pos: vec3f) -> f32 {
    \\    if (SH.has_shadow < 0.5) { return 1.0; }
    \\    let lp = SH.light_vp * vec4f(world_pos, 1.0);
    \\    if (lp.w <= 0.0) { return 1.0; }
    \\    let ndc = lp.xyz / lp.w;
    \\    if (ndc.z > 1.0 || ndc.z < 0.0) { return 1.0; }
    \\    let uv = ndc.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
    \\    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
    \\    let cmp = ndc.z - SH.bias;
    \\    var sum = 0.0;
    \\    for (var dy = -1; dy <= 1; dy = dy + 1) {
    \\        for (var dx = -1; dx <= 1; dx = dx + 1) {
    \\            let o = vec2f(f32(dx), f32(dy)) * SH.texel;
    \\            sum = sum + textureSampleCompareLevel(shadow_tex, shadow_smp, uv + o, cmp);
    \\        }
    \\    }
    \\    return sum / 9.0;
    \\}
    \\
;

const scene3d_vs_main =
    \\// ── Vertex shader ────────────────────────────────────────────
    \\@vertex
    \\fn vs_main(in: VertexInput, @builtin(vertex_index) vid: u32) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    let model = rebuild_model(in.inst_pos, in.inst_euler, in.inst_scale);
    \\    let world = model * vec4f(in.position, 1.0);
    \\    out.clip_pos = S.vp * world;
    \\    out.world_pos = world.xyz;
    \\    out.world_normal = normalize((model * vec4f(oct_decode(in.noct), 0.0)).xyz);
    \\    out.uv = in.uv;
    \\    out.inst_color = in.inst_color;
    \\    out.screen_y = out.clip_pos.y / out.clip_pos.w;
    \\    // Tag this vertex with its corner of the triangle. Meshes are non-indexed
    \\    // triangle lists (3 verts/tri, in order), so vid%3 IS the corner — no extra
    \\    // vertex attribute needed. Unused (but cheap) when wireframe is off.
    \\    let corner = vid % 3u;
    \\    out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
    \\    return out;
    \\}
    \\
;

const scene3d_fs =
    \\// ── Fragment shader (Blinn-Phong + diffuse texture) ──────────
    \\// Meshes without an explicit texture get a 1×1 white default, so the multiply
    \\// collapses to the per-instance color and behavior matches the pre-texture path.
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let N = normalize(in.world_normal);
    \\    let L = normalize(S.light_dir);
    \\    let V = normalize(S.camera_pos - in.world_pos);
    \\    let diff = max(dot(N, L), 0.0);
    \\    let H = normalize(L + V);
    \\    let spec = pow(max(dot(N, H), 0.0), S.specular_power);
    \\    let raw_tex_sample = textureSample(diffuse_tex, diffuse_smp, in.uv);
    \\    let uv_in_bounds = all(in.uv >= vec2f(0.0)) && all(in.uv <= vec2f(1.0));
    \\    let sampled_alpha = select(0.0, raw_tex_sample.a, uv_in_bounds || diffuse_sampling.x < 0.5);
    \\    let tex_sample = vec4f(raw_tex_sample.rgb, sampled_alpha);
    \\    let base = in.inst_color.rgb * tex_sample.rgb;
    \\    let ambient = S.ambient_color * base;
    \\    let diffuse = S.light_color * base * diff;
    \\    let specular = S.light_color * spec * 0.4;
    \\    // ── Placed lights (the pyramids) ──────────────────────────────
    \\    // Each light adds a contribution that falls off with distance (smooth to
    \\    // zero at `range`) and, for a spot, with the cone (cos_outer..cos_inner).
    \\    // An omni bulb has cos_outer = -1, so the cone term collapses to a flat 1.
    \\    var placed = vec3f(0.0, 0.0, 0.0);
    \\    let n_lights = u32(S.light_count);
    \\    // One visibility sample (uniform control flow); applied only to the caster.
    \\    let svis = shadow_vis(in.world_pos);
    \\    let caster = u32(SH.caster_index);
    \\    for (var i: u32 = 0u; i < n_lights; i = i + 1u) {
    \\        let lt = lights[i];
    \\        let to_light = lt.pos - in.world_pos;
    \\        let dist = length(to_light);
    \\        if (dist >= lt.range) { continue; }
    \\        let Ld = to_light / max(dist, 1e-4);
    \\        let ndl = max(dot(N, Ld), 0.0);
    \\        // Distance density: smooth quadratic falloff, exactly 0 at the reach.
    \\        let dd = clamp(1.0 - dist / lt.range, 0.0, 1.0);
    \\        let atten = dd * dd;
    \\        // Cone density: 1 inside the inner angle, fading to 0 by the outer.
    \\        let aim = dot(normalize(-to_light), normalize(lt.dir));
    \\        let cone = clamp((aim - lt.cos_outer) / max(lt.cos_inner - lt.cos_outer, 1e-3), 0.0, 1.0);
    \\        let falloff = atten * cone * lt.intensity;
    \\        let Hl = normalize(Ld + V);
    \\        let sp = pow(max(dot(N, Hl), 0.0), S.specular_power) * 0.4;
    \\        // The shadow-casting light is occluded by the depth map; others are flat-lit.
    \\        let vis = select(1.0, svis, SH.has_shadow > 0.5 && i == caster);
    \\        placed = placed + lt.color * (base * ndl + sp) * falloff * vis;
    \\    }
    \\    var lit = ambient + diffuse + specular + placed;
    \\    // ── Matcap (S.matcap == 1, req_3766): shade by the VIEW-SPACE normal so
    \\    // EVERY normal change reads as a tone/hue step. Flat N·L collapses any
    \\    // low-dihedral edge — and even a sharp crease whose two normals sit
    \\    // symmetric about L — into one band, which is why a modelled body renders
    \\    // as one mass. The sculpt-app answer: a top-lit sphere ramp over the view
    \\    // basis, a warm/cool lateral split (hue disambiguates normals the ramp
    \\    // alone cannot), and grazing-angle darkening so crease walls and the
    \\    // silhouette read dark. Placed lights still add (lamp previews survive).
    \\    if (S.matcap > 0.5) {
    \\        let ndv = clamp(dot(N, V), 0.0, 1.0);
    \\        let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(V.y) > 0.94);
    \\        let side = normalize(cross(axis, V));
    \\        let upv = cross(V, side);
    \\        let nx = dot(N, side);
    \\        let ny = dot(N, upv);
    \\        let ball = 0.62 + 0.46 * ny;
    \\        let graze = 0.30 + 0.70 * smoothstep(0.0, 0.5, ndv);
    \\        let warm_cool = vec3f(0.085 * nx, 0.02 * ny, -0.095 * nx);
    \\        let mc = base * ball * graze + warm_cool + placed;
    \\        let mc_a = in.inst_color.a * tex_sample.a;
    \\        if (mc_a <= 0.01) { discard; }
    \\        return vec4f(mc * mc_a, mc_a);
    \\    }
    \\    let fog_t = smoothstep(S.fog_near, S.fog_far, distance(S.camera_pos, in.world_pos));
    \\    // Aerial perspective: fade toward the sky colour in this fragment's screen
    \\    // direction (the same vertical gradient drawSky paints), so geometry melts
    \\    // into the exact sky behind it — a tall peak no longer leaves a flat
    \\    // horizon-coloured silhouette that pops when culled. fog_sky == 0 keeps the
    \\    // flat fog_color (no skybox / explicit <Fog color>).
    \\    let g = clamp(in.screen_y * 0.5 + 0.5, 0.0, 1.0);
    \\    let sky_grad = mix(S.sky_horizon, S.sky_zenith.xyz, pow(g, 0.6));
    \\    let fog_target = mix(S.fog_color, sky_grad, S.fog_sky);
    \\    let final_rgb = mix(lit, fog_target, fog_t);
    \\    // Premultiplied-alpha output: the mesh pipeline blends with
    \\    // premultiplied_alpha_blending, so scale rgb by alpha here. Opaque meshes
    \\    // (a == 1) are unchanged; glass (a < 1) composites correctly over the scene.
    \\    let out_a = in.inst_color.a * tex_sample.a;
    \\    // Wireframe overlay (S.wire == 1): a bright line along every triangle edge,
    \\    // width CONSTANT in screen pixels via fwidth — so it never thickens or detaches
    \\    // as you zoom, because it is drawn from THIS triangle's own barycentric and is
    \\    // pixel-locked to the surface. fwidth is evaluated unconditionally to keep the
    \\    // derivative in uniform control flow; the branch only uses the result.
    \\    let bmin = min(in.bary.x, min(in.bary.y, in.bary.z));
    \\    let bw = fwidth(bmin) * 1.5;
    \\    if (S.wire > 0.5) {
    \\        let edge = 1.0 - smoothstep(0.0, max(bw, 1e-5), bmin);
    \\        // Adaptive contrast: a dark line over a light surface, a light line over a dark
    \\        // one — so the wireframe never vanishes (e.g. white lines on a white model).
    \\        let wire_lum = dot(final_rgb, vec3f(0.299, 0.587, 0.114));
    \\        // Threshold biased low (0.32) so the default light-grey model gets DARK wires —
    \\        // only genuinely dark surfaces flip to a light line.
    \\        let wire_col = select(vec3f(0.94, 0.96, 1.0), vec3f(0.01, 0.02, 0.06), wire_lum > 0.32);
    \\        let lines = mix(final_rgb, wire_col, edge);
    \\        // Edges stay opaque even over alpha-cut texels, so the wire is unbroken.
    \\        let wa = max(out_a, edge);
    \\        if (wa <= 0.01) { discard; }
    \\        return vec4f(lines * wa, wa);
    \\    }
    \\    // Alpha-cut fully-transparent texels (req_0915): a decal with a transparent
    \\    // background (a floating neon sign) shows ONLY its lit texels — discarding
    \\    // the empty ones writes no color AND no depth, so the wall behind shows
    \\    // through cleanly. Harmless elsewhere: opaque meshes sample the 1×1 white
    \\    // default (a == 1) and never hit this.
    \\    if (out_a <= 0.01) { discard; }
    \\    return vec4f(final_rgb * out_a, out_a);
    \\}
;

pub const scene3d_wgsl = oct_decode_wgsl ++ scene3d_decls ++ scene3d_vs_input ++ scene3d_common ++ scene3d_vs_main ++ scene3d_fs;

// SKINNED vertex input (SKIN-3499): the standard layout plus a bone palette.
// Each palette entry is a column-major MODEL-SPACE matrix (the inverse-bind
// translation is folded in host-side by skeleton/pose.zig) + an rgba tint —
// 80 bytes std430 (mat4x4f + vec4f), matching the 20-float wire rows the
// world loader writes. Weights arrive unorm8-quantized, so the vertex stage
// renormalizes by the weight sum — rigid exports (w = 1,0,0,0) pass through
// exactly and reproduce today's per-part transforms bit-for-visual-bit.
const scene3d_skinned_vs_input =
    \\struct BoneData {
    \\    m: mat4x4f,
    \\    color: vec4f,
    \\};
    \\@group(2) @binding(0) var<storage, read> bones: array<BoneData>;
    \\
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_euler: vec4u,   // rx, ry, rz (u16 deg ring) + pad
    \\    @location(5) inst_scale: vec4f,   // sx, sy, sz (f16 m) + pad
    \\    @location(6) inst_color: vec4f,   // rgba (unorm8)
    \\    @location(7) joints: vec4u,       // bone indices (uint8x4)
    \\    @location(8) weights: vec4f,      // bone weights (unorm8x4)
    \\};
    \\
;

const scene3d_skinned_vs_main =
    \\// ── Vertex shader (matrix-palette LBS) ───────────────────────
    \\// model = instance root (the figure's world placement) × the weighted
    \\// blend of bone matrices. The normal rides the same matrix as the base
    \\// path (no inverse-transpose; bone scales are ~uniform in practice).
    \\@vertex
    \\fn vs_main(in: VertexInput, @builtin(vertex_index) vid: u32) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    let ws = max(in.weights.x + in.weights.y + in.weights.z + in.weights.w, 1e-4);
    \\    let skin_m = (in.weights.x * bones[in.joints.x].m
    \\                + in.weights.y * bones[in.joints.y].m
    \\                + in.weights.z * bones[in.joints.z].m
    \\                + in.weights.w * bones[in.joints.w].m) * (1.0 / ws);
    \\    let bone_col = (in.weights.x * bones[in.joints.x].color
    \\                  + in.weights.y * bones[in.joints.y].color
    \\                  + in.weights.z * bones[in.joints.z].color
    \\                  + in.weights.w * bones[in.joints.w].color) * (1.0 / ws);
    \\    let model = rebuild_model(in.inst_pos, in.inst_euler, in.inst_scale) * skin_m;
    \\    let world = model * vec4f(in.position, 1.0);
    \\    out.clip_pos = S.vp * world;
    \\    out.world_pos = world.xyz;
    \\    out.world_normal = normalize((model * vec4f(oct_decode(in.noct), 0.0)).xyz);
    \\    out.uv = in.uv;
    \\    out.inst_color = in.inst_color * bone_col;
    \\    out.screen_y = out.clip_pos.y / out.clip_pos.w;
    \\    let corner = vid % 3u;
    \\    out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
    \\    return out;
    \\}
    \\
;

/// Skinned 3D mesh pipeline (SKIN-3499) — scene3d with a matrix-palette LBS
/// vertex stage. Shares decls/common/fragment with scene3d_wgsl by construction.
pub const scene3d_skinned_wgsl = oct_decode_wgsl ++ scene3d_decls ++ scene3d_skinned_vs_input ++ scene3d_common ++ scene3d_skinned_vs_main ++ scene3d_fs;

/// Skinned shadow-depth variant (SKIN-3499): group(0) = the light VP (same as
/// shadow_depth_wgsl), group(1) = the bone palette. rebuild_model MUST stay
/// byte-identical to the other copies (same lockstep invariant).
pub const shadow_depth_skinned_wgsl =
    \\@group(0) @binding(0) var<uniform> LVP: mat4x4f;
    \\struct BoneData {
    \\    m: mat4x4f,
    \\    color: vec4f,
    \\};
    \\@group(1) @binding(0) var<storage, read> bones: array<BoneData>;
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (unused here)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_euler: vec4u,
    \\    @location(5) inst_scale: vec4f,
    \\    @location(6) inst_color: vec4f,
    \\    @location(7) joints: vec4u,
    \\    @location(8) weights: vec4f,
    \\};
    \\fn rebuild_model(inst_pos: vec3f, inst_euler: vec4u, inst_scale: vec4f) -> mat4x4f {
    \\    let a = 360.0 / 65536.0 * 0.017453292;
    \\    let rot = vec3f(f32(inst_euler.x), f32(inst_euler.y), f32(inst_euler.z)) * a;
    \\    let s = inst_scale.xyz;
    \\    let crx = cos(rot.x); let srx = sin(rot.x);
    \\    let cry = cos(rot.y); let sry = sin(rot.y);
    \\    let crz = cos(rot.z); let srz = sin(rot.z);
    \\    let mS  = mat4x4f(vec4f(s.x,0,0,0), vec4f(0,s.y,0,0), vec4f(0,0,s.z,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,crx,srx,0), vec4f(0,-srx,crx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cry,0,-sry,0), vec4f(0,1,0,0), vec4f(sry,0,cry,0), vec4f(0,0,0,1));
    \\    let mRz = mat4x4f(vec4f(crz,srz,0,0), vec4f(-srz,crz,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
    \\    let mT  = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(inst_pos,1));
    \\    return mT * mRy * mRx * mRz * mS;
    \\}
    \\@vertex
    \\fn vs_main(in: VertexInput) -> @builtin(position) vec4f {
    \\    let ws = max(in.weights.x + in.weights.y + in.weights.z + in.weights.w, 1e-4);
    \\    let skin_m = (in.weights.x * bones[in.joints.x].m
    \\                + in.weights.y * bones[in.joints.y].m
    \\                + in.weights.z * bones[in.joints.z].m
    \\                + in.weights.w * bones[in.joints.w].m) * (1.0 / ws);
    \\    let model = rebuild_model(in.inst_pos, in.inst_euler, in.inst_scale) * skin_m;
    \\    return LVP * model * vec4f(in.position, 1.0);
    \\}
;

/// Shadow depth pipeline — renders scene geometry from a light's POV into a depth
/// map (no color). Same vertex buffers/layout as scene3d (vbuf0 verts, vbuf1 packed
/// InstanceData), so the same staged instances replay here. rebuild_model MUST stay
/// byte-identical to scene3d_wgsl's copy. Group0 binding0 = the light's VP.
pub const shadow_depth_wgsl =
    \\@group(0) @binding(0) var<uniform> LVP: mat4x4f;
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_euler: vec4u,
    \\    @location(5) inst_scale: vec4f,
    \\    @location(6) inst_color: vec4f,
    \\};
    \\fn rebuild_model(inst_pos: vec3f, inst_euler: vec4u, inst_scale: vec4f) -> mat4x4f {
    \\    let a = 360.0 / 65536.0 * 0.017453292;
    \\    let rot = vec3f(f32(inst_euler.x), f32(inst_euler.y), f32(inst_euler.z)) * a;
    \\    let s = inst_scale.xyz;
    \\    let crx = cos(rot.x); let srx = sin(rot.x);
    \\    let cry = cos(rot.y); let sry = sin(rot.y);
    \\    let crz = cos(rot.z); let srz = sin(rot.z);
    \\    let mS  = mat4x4f(vec4f(s.x,0,0,0), vec4f(0,s.y,0,0), vec4f(0,0,s.z,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,crx,srx,0), vec4f(0,-srx,crx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cry,0,-sry,0), vec4f(0,1,0,0), vec4f(sry,0,cry,0), vec4f(0,0,0,1));
    \\    let mRz = mat4x4f(vec4f(crz,srz,0,0), vec4f(-srz,crz,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
    \\    let mT  = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(inst_pos,1));
    \\    return mT * mRy * mRx * mRz * mS;
    \\}
    \\@vertex
    \\fn vs_main(in: VertexInput) -> @builtin(position) vec4f {
    \\    let model = rebuild_model(in.inst_pos, in.inst_euler, in.inst_scale);
    \\    return LVP * model * vec4f(in.position, 1.0);
    \\}
;

/// Grass pipeline shader — a variant of scene3d_wgsl for the instanced blade field
/// (the FluffyGrass look). Same uniform layout, same instanced VertexInput, drawn
/// with the SAME pipeline layout as scene3d so the host just swaps the module for
/// grass-flagged groups (gpu/3d.zig). Three things differ from scene3d_wgsl:
///   1. VERTEX wind — the unit-tall blade (uv.y 0=root,1=tip) sways. The gust phase
///      comes from the blade's WORLD xz, so neighbours share it (a gust ripples
///      across the field, not per-blade jitter); the bend is weighted by uv.y^1.5
///      so the root stays planted and only the tip moves. `S.time` is the wrapped
///      wall-clock the host writes into the (formerly _pad3) uniform slot.
///   2. FRAGMENT wisp cutout — each card is cut into several tapered blades
///      procedurally (no texture asset; pure formula), so one card reads as many.
///   3. FRAGMENT gradient — dark per-instance root tint -> bright lime tip, with
///      per-blade tip-colour variation, lit with a soft half-lambert (double-sided
///      blades shouldn't go black on their back).
pub const grass_wgsl = oct_decode_wgsl ++
    \\struct SceneUniforms {
    \\    vp: mat4x4f,
    \\    light_dir: vec3f,
    \\    specular_power: f32,
    \\    light_color: vec3f,
    \\    _pad1: f32,
    \\    ambient_color: vec3f,
    \\    _pad2: f32,
    \\    camera_pos: vec3f,
    \\    time: f32,
    \\    fog_color: vec3f,
    \\    fog_near: f32,
    \\    fog_far: f32,
    \\    fog_sky: f32,
    \\    wire: f32,      // 152 — wireframe flag in the shared scene uniform buffer; only scene3d_wgsl reads it (was _pad4a)
    \\    matcap: f32,    // 156 — shade by view-space normal, req_3766; only scene3d_wgsl reads it (was _pad4b)
    \\    sky_horizon: vec3f,
    \\    _pad5: f32,
    \\    sky_zenith: vec4f,
    \\};
    \\@group(0) @binding(0) var<uniform> S: SceneUniforms;
    \\@group(1) @binding(0) var diffuse_tex: texture_2d<f32>;
    \\@group(1) @binding(1) var diffuse_smp: sampler;
    \\
    \\// Slim per-instance input (the 24-byte SlimInstance, 3d.zig) — grass/bush/flower
    \\// cards. The model matrix is REBUILT from TRS instead of shipped as 64 bytes;
    \\// these cards are yaw-only (pitch 0). Decode MUST match makeSlimInstance: angle
    \\// deg = u16/65536*360, scale m = unorm*16.
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_angles: vec2u,   // pitch, yaw (u16 ring)
    \\    @location(5) inst_scale: vec2f,    // wide, len (unorm × 16 m)
    \\    @location(6) inst_color: vec4f,
    \\};
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) world_pos: vec3f,
    \\    @location(1) world_normal: vec3f,
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_color: vec4f,
    \\    @location(4) @interpolate(linear) screen_y: f32,
    \\};
    \\
    \\fn hash21(p: vec2f) -> f32 {
    \\    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
    \\}
    \\
    \\@vertex
    \\fn vs_main(in: VertexInput) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    // Rebuild model = T · Ry(yaw) · Rx(pitch) · S(wide,len,wide), column-major to
    \\    // match makeInstance's row-major T·Ry·Rx·Rz·S (rz=0) after its transpose.
    \\    let deg = 360.0 / 65536.0;
    \\    let pitch = f32(in.inst_angles.x) * deg * 0.017453292;
    \\    let yaw = f32(in.inst_angles.y) * deg * 0.017453292;
    \\    let wide = in.inst_scale.x * 16.0;
    \\    let len = in.inst_scale.y * 16.0;
    \\    let cx = cos(pitch); let sx = sin(pitch);
    \\    let cy = cos(yaw);   let sy = sin(yaw);
    \\    let mS = mat4x4f(vec4f(wide,0,0,0), vec4f(0,len,0,0), vec4f(0,0,wide,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,cx,sx,0), vec4f(0,-sx,cx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cy,0,-sy,0), vec4f(0,1,0,0), vec4f(sy,0,cy,0), vec4f(0,0,0,1));
    \\    let mT = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(in.inst_pos,1));
    \\    let model = mT * mRy * mRx * mS;
    \\    var world = model * vec4f(in.position, 1.0);
    \\    let tipw = pow(clamp(in.uv.y, 0.0, 1.0), 1.5);
    \\    let phase = world.x * 0.18 + world.z * 0.22 + S.time * 1.5;
    \\    let sway = sin(phase) + 0.4 * sin(phase * 2.7 + 1.3);
    \\    let gust = 0.10 + 0.10 * sin(S.time * 0.5 + world.x * 0.05);
    \\    // req_1665: cut the wind beyond 60m from the camera (faded over 50..60) so a
    \\    // full-radius grass field does not pay per-vertex sway for blades far away.
    \\    let anim_fade = smoothstep(60.0, 50.0, distance(S.camera_pos, world.xyz));
    \\    let bend = sway * gust * tipw * anim_fade;
    \\    let wind_dir = normalize(vec2f(0.8, 0.6));
    \\    world.x = world.x + wind_dir.x * bend;
    \\    world.z = world.z + wind_dir.y * bend;
    \\    world.y = world.y - abs(bend) * 0.12;
    \\    out.clip_pos = S.vp * world;
    \\    out.world_pos = world.xyz;
    \\    out.world_normal = normalize((model * vec4f(oct_decode(in.noct), 0.0)).xyz);
    \\    out.uv = in.uv;
    \\    out.inst_color = in.inst_color;
    \\    out.screen_y = out.clip_pos.y / out.clip_pos.w;
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    var albedo: vec3f;
    \\    if (in.uv.x > 5.0) {
    \\        // FlowerHead geometry lives in UV band 10..11. It still gets the same
    \\        // vertex wind as a blade tip (uv.y clamps to 1 in vs_main), but here
    \\        // the card cuts to a round colored blossom instead of green wisps.
    \\        let fuv = vec2f(in.uv.x - 10.0, in.uv.y - 10.0);
    \\        let fp = fuv - vec2f(0.5);
    \\        let r = length(fp);
    \\        if (r > 0.5) { discard; }
    \\        let center = 1.0 - smoothstep(0.11, 0.18, r);
    \\        let rim = 1.0 - smoothstep(0.34, 0.5, r);
    \\        let petal_col = in.inst_color.rgb * (0.72 + 0.28 * rim);
    \\        albedo = mix(petal_col, vec3f(0.98, 0.78, 0.20), center);
    \\    } else {
    \\        let v = clamp(in.uv.y, 0.0, 1.0);
    \\        // Three sub-blades across the card width — one card reads as many.
    \\        let nbl = 3.0;
    \\        let bid = floor(in.uv.x * nbl);
    \\        let bu = fract(in.uv.x * nbl);
    \\        let r0 = hash21(vec2f(bid, 1.0));
    \\        let r1 = hash21(vec2f(bid, 2.0));
    \\        let max_v = 0.65 + 0.35 * r0;        // each wisp stops at its own height
    \\        let half_w = (0.30 - 0.26 * v) * (0.55 + 0.45 * r1); // tapers to a point
    \\        let d = abs(bu - 0.5);
    \\        var mask = smoothstep(half_w, half_w * 0.55, d);
    \\        if (v > max_v) { mask = 0.0; }
    \\        if (mask < 0.5) { discard; }
    \\        // Dark per-instance root tint -> bright lime tip, varied per blade.
    \\        let root_col = in.inst_color.rgb;
    \\        let tip_var = hash21(floor(in.world_pos.xz));
    \\        let tip_col = mix(vec3f(0.55, 0.78, 0.36), vec3f(0.78, 0.86, 0.42), tip_var);
    \\        albedo = mix(root_col, tip_col, pow(v, 1.2));
    \\    }
    \\    // Soft half-lambert so the blade's back side isn't black.
    \\    let N = normalize(in.world_normal);
    \\    let L = normalize(S.light_dir);
    \\    let ndl = dot(N, L) * 0.5 + 0.5;
    \\    let lit = albedo * (S.ambient_color + S.light_color * ndl * 0.9);
    \\    // Aerial fog identical to scene3d_wgsl.
    \\    let fog_t = smoothstep(S.fog_near, S.fog_far, distance(S.camera_pos, in.world_pos));
    \\    let g = clamp(in.screen_y * 0.5 + 0.5, 0.0, 1.0);
    \\    let sky_grad = mix(S.sky_horizon, S.sky_zenith.xyz, pow(g, 0.6));
    \\    let fog_target = mix(S.fog_color, sky_grad, S.fog_sky);
    \\    let final_rgb = mix(lit, fog_target, fog_t);
    \\    return vec4f(final_rgb, 1.0);
    \\}
;

/// Stylized water pipeline — the fixed host system behind a "~water~" body
/// (GUIDING_LIGHT: the DATA is "a water body lives here, this footprint"; the
/// LOOK is this dumb fixed system, exactly like grass). An instanced batch whose
/// leader carries the "~water~" tex-key sentinel swaps to g_water_pipeline.
///
/// The mesh shipped is a STATIC flat heightfield (top surface at surfaceY +
/// perimeter skirt to the basin floor — the body's volume). All motion is here,
/// driven by S.time, so nothing re-bakes per tick:
///   • vertex: a multi-octave domain-warped sine field (FBM) displaces ONLY the
///     top surface (weighted by normal.y, so the skirt stays put), in WORLD xz so
///     waves are continuous across the body and independent of its size.
///   • fragment: deep→shallow colour by wave height, white foam on crests and at
///     the shore edge (uv proximity), then an ordered Bayer 8x8 alpha-hash —
///     that dithered halftone IS the see-through water (discard, no blend pass).
/// Ported from the beach-viewer water shader (Water_GetWaves / Water_WaveShape),
/// adapted from UV-space to world-space and from GLSL gl_FragCoord to WGSL's
/// @builtin(position).
pub const water_wgsl = oct_decode_wgsl ++
    \\struct SceneUniforms {
    \\    vp: mat4x4f,
    \\    light_dir: vec3f,
    \\    specular_power: f32,
    \\    light_color: vec3f,
    \\    _pad1: f32,
    \\    ambient_color: vec3f,
    \\    _pad2: f32,
    \\    camera_pos: vec3f,
    \\    time: f32,
    \\    fog_color: vec3f,
    \\    fog_near: f32,
    \\    fog_far: f32,
    \\    fog_sky: f32,
    \\    wire: f32,      // 152 — wireframe flag in the shared scene uniform buffer; only scene3d_wgsl reads it (was _pad4a)
    \\    matcap: f32,    // 156 — shade by view-space normal, req_3766; only scene3d_wgsl reads it (was _pad4b)
    \\    sky_horizon: vec3f,
    \\    _pad5: f32,
    \\    sky_zenith: vec4f,
    \\};
    \\@group(0) @binding(0) var<uniform> S: SceneUniforms;
    \\@group(1) @binding(0) var diffuse_tex: texture_2d<f32>;
    \\@group(1) @binding(1) var diffuse_smp: sampler;
    \\
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_euler: vec4u,
    \\    @location(5) inst_scale: vec4f,
    \\    @location(6) inst_color: vec4f,
    \\};
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) world_pos: vec3f,
    \\    @location(1) world_normal: vec3f,
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_color: vec4f,
    \\    @location(4) wave: f32,
    \\    @location(5) @interpolate(linear) screen_y: f32,
    \\};
    \\
    \\// Water look — the ONE shared look (mirrors waterBodies.ts WATER_LOOK).
    \\const DEEP_COL = vec3f(0.06, 0.22, 0.38);
    \\const SHALLOW_COL = vec3f(0.18, 0.52, 0.66);
    \\const FOAM_COL = vec3f(0.92, 0.97, 1.0);
    \\const WAVE_AMP = 0.35;       // metres of vertical displacement at the crest
    \\const WAVE_FREQ = 0.10;      // world-space wave frequency (cycles/metre-ish)
    \\const WATER_ALPHA = 0.82;    // dither coverage — ~18% sees through as halftone
    \\
    \\fn hash21(p: vec2f) -> f32 {
    \\    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
    \\}
    \\// Smooth value noise → vec2 domain-warp offset (beach-viewer SmoothNoise22).
    \\fn smooth_noise22(p: vec2f) -> vec2f {
    \\    let i = floor(p);
    \\    var f = fract(p);
    \\    f = f * f * (3.0 - 2.0 * f);
    \\    let a = hash21(i);
    \\    let b = hash21(i + vec2f(1.0, 0.0));
    \\    let c = hash21(i + vec2f(0.0, 1.0));
    \\    let d = hash21(i + vec2f(1.0, 1.0));
    \\    let n = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    \\    return vec2f(n, n);
    \\}
    \\fn wave_shape(uv_in: vec2f, chop: f32) -> f32 {
    \\    let uv = uv_in + smooth_noise22(uv_in * 0.6) * 2.0;
    \\    var w = sin(uv * 2.0) * 0.5 + vec2f(0.5);
    \\    w = vec2f(1.0) - pow(vec2f(1.0) - w, vec2f(chop));
    \\    return (w.x + w.y) * 0.5;
    \\}
    \\// FBM of 5 rotated/scaled sine-noise octaves → wave height in [0,1].
    \\fn get_waves(map_pos: vec2f, t: f32) -> f32 {
    \\    var a = 1.0;
    \\    var h = 0.0;
    \\    var tot = 0.0;
    \\    let r = 2.5;
    \\    let rm = mat2x2f(cos(r), -sin(r), sin(r), cos(r)) * 2.1;
    \\    var a_pos = map_pos;
    \\    var wave_t = t;
    \\    for (var o = 0; o < 5; o = o + 1) {
    \\        let chop = mix(0.7, 0.9, f32(o) / 4.0);
    \\        h = h + wave_shape(a_pos + vec2f(wave_t), chop) * a;
    \\        tot = tot + a;
    \\        a_pos = a_pos * rm;
    \\        a = a * 0.3;
    \\        wave_t = wave_t * 1.6;
    \\    }
    \\    return h / tot;
    \\}
    \\
    \\// Rebuild the model matrix from the packed instance (32-byte InstanceData) —
    \\// column-major twin of makeInstance's row-major T·Ry·Rx·Rz·S. MUST stay in sync.
    \\fn rebuild_model(inst_pos: vec3f, inst_euler: vec4u, inst_scale: vec4f) -> mat4x4f {
    \\    let a = 360.0 / 65536.0 * 0.017453292;
    \\    let rot = vec3f(f32(inst_euler.x), f32(inst_euler.y), f32(inst_euler.z)) * a;
    \\    let s = inst_scale.xyz;
    \\    let crx = cos(rot.x); let srx = sin(rot.x);
    \\    let cry = cos(rot.y); let sry = sin(rot.y);
    \\    let crz = cos(rot.z); let srz = sin(rot.z);
    \\    let mS  = mat4x4f(vec4f(s.x,0,0,0), vec4f(0,s.y,0,0), vec4f(0,0,s.z,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,crx,srx,0), vec4f(0,-srx,crx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cry,0,-sry,0), vec4f(0,1,0,0), vec4f(sry,0,cry,0), vec4f(0,0,0,1));
    \\    let mRz = mat4x4f(vec4f(crz,srz,0,0), vec4f(-srz,crz,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
    \\    let mT  = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(inst_pos,1));
    \\    return mT * mRy * mRx * mRz * mS;
    \\}
    \\@vertex
    \\fn vs_main(in: VertexInput) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    let model = rebuild_model(in.inst_pos, in.inst_euler, in.inst_scale);
    \\    var world = model * vec4f(in.position, 1.0);
    \\    let wn = normalize((model * vec4f(oct_decode(in.noct), 0.0)).xyz);
    \\    // Only the up-facing top surface rides the waves; the skirt (horizontal
    \\    // normal) stays anchored so the volume edge holds.
    \\    let top_w = clamp(wn.y, 0.0, 1.0);
    \\    let map_pos = world.xz * WAVE_FREQ;
    \\    let wh = get_waves(map_pos, S.time * 0.4);
    \\    world.y = world.y + (wh - 0.5) * WAVE_AMP * top_w;
    \\    out.clip_pos = S.vp * world;
    \\    out.world_pos = world.xyz;
    \\    out.world_normal = wn;
    \\    out.uv = in.uv;
    \\    out.inst_color = in.inst_color;
    \\    out.wave = wh;
    \\    out.screen_y = out.clip_pos.y / out.clip_pos.w;
    \\    return out;
    \\}
    \\
    \\fn bayer8(p: vec2f) -> f32 {
    \\    let x = i32(p.x) & 7;
    \\    let y = i32(p.y) & 7;
    \\    var m = array<f32, 64>(
    \\        0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0,
    \\        48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
    \\        12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0,
    \\        60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
    \\        3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0,
    \\        51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
    \\        15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0,
    \\        63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0
    \\    );
    \\    return (m[y * 8 + x] + 0.5) / 64.0;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    // Recompute waves per-fragment (sharper than interpolating the vertex value).
    \\    let map_pos = in.world_pos.xz * WAVE_FREQ;
    \\    let waves = get_waves(map_pos, S.time * 0.4);
    \\    // Local water-column depth (metres) rides in UV.x — baked by gpu/3d.zig hfGen
    \\    // from the painted depth grid: 0 at the waterline → 12 m (HF_DEPTH_NORM) deep.
    \\    let depth_m = in.uv.x * 12.0;
    \\    // Colour by DEPTH: light shallows near shore, darkening to ~6 m. A touch of
    \\    // wave lightening keeps crests alive over the gradient.
    \\    var colour = mix(SHALLOW_COL, DEEP_COL, smoothstep(0.0, 6.0, depth_m));
    \\    colour = mix(colour, SHALLOW_COL, smoothstep(0.6, 1.0, waves) * 0.25);
    \\    // Foam = subtle wave crests + a SHORELINE band measured in real HORIZONTAL
    \\    // metres, NOT depth. Converting depth→distance via the world-space depth
    \\    // gradient (screen derivatives) keeps the run-up a fixed ground width no
    \\    // matter how gentle the slope — a shallow grade no longer smears foam across
    \\    // the whole body. Reach varies ~2–14 m along the coast (noise) + washes in/out.
    \\    let foam_noise = hash21(floor(map_pos * 8.0) + floor(vec2f(S.time * 2.0)));
    \\    let crest = smoothstep(0.86, 0.98, waves) * 0.6; // calmer open-water whitecaps
    \\    let shore_noise = get_waves(in.world_pos.xz * 0.04, S.time * 0.18);
    \\    let wash = sin(S.time * 0.6 + shore_noise * 6.2831) * 0.5 + 0.5;
    \\    // World metres per screen pixel (max of the two screen axes) and depth change
    \\    // per pixel → slope (depth m per world m) → horizontal distance to the waterline.
    \\    let wp_ddx = vec2f(dpdx(in.world_pos.x), dpdx(in.world_pos.z));
    \\    let wp_ddy = vec2f(dpdy(in.world_pos.x), dpdy(in.world_pos.z));
    \\    let world_per_px = max(max(length(wp_ddx), length(wp_ddy)), 1e-4);
    \\    let depth_grad = length(vec2f(dpdx(depth_m), dpdy(depth_m))) / world_per_px;
    \\    let shore_dist_m = depth_m / max(depth_grad, 1e-3);
    \\    let reach_m = mix(2.0, 14.0, shore_noise) * mix(0.5, 1.0, wash);
    \\    let shore = 1.0 - smoothstep(0.0, reach_m, shore_dist_m);
    \\    var foam = clamp(max(crest, shore), 0.0, 1.0);
    \\    foam = smoothstep(0.35, 0.85, foam + (foam_noise - 0.5) * 0.3);
    \\    colour = mix(colour, FOAM_COL, foam);
    \\    // Soft half-lambert so a wave back-face isn't flat.
    \\    let N = normalize(in.world_normal);
    \\    let L = normalize(S.light_dir);
    \\    let ndl = dot(N, L) * 0.5 + 0.5;
    \\    colour = colour * (S.ambient_color + S.light_color * ndl * 0.6);
    \\    // Aerial fog (matches scene3d_wgsl) so distant water meets the sky.
    \\    let fog_t = smoothstep(S.fog_near, S.fog_far, distance(S.camera_pos, in.world_pos));
    \\    let g = clamp(in.screen_y * 0.5 + 0.5, 0.0, 1.0);
    \\    let sky_grad = mix(S.sky_horizon, S.sky_zenith.xyz, pow(g, 0.6));
    \\    let fog_target = mix(S.fog_color, sky_grad, S.fog_sky);
    \\    colour = mix(colour, fog_target, fog_t);
    \\    // Ordered alpha-hash: the dithered holes ARE the water's transparency.
    \\    // Foam is opaque (alpha 1); open water dithers at WATER_ALPHA; the shallowest
    \\    // film fades toward clear so the surface dissolves into wet sand at the
    \\    // waterline instead of ending on a hard edge.
    \\    let shallow_fade = smoothstep(0.0, 0.25, depth_m);
    \\    let alpha = mix(WATER_ALPHA * shallow_fade, 1.0, foam);
    \\    if (alpha < bayer8(in.clip_pos.xy)) { discard; }
    \\    return vec4f(colour, 1.0);
    \\}
;

/// Frond pipeline — the foliage move (FluffyGrass / the ~grass~ twin) applied to
/// PALM/LEAF cards: a tree crown is many Frond instances radiating from the trunk
/// top, each a dumb arched card this shader paints. The fragment alpha-cuts the
/// leaf SHAPE from the card and the vertex bends it by wind (tip-weighted), so the
/// whole crown sways like the grass field. The leaf STYLE is baked into 10-wide
/// uv.u bands: 0 feathered coconut, 1 broad split leaf, 2 conifer spray, 3
/// deciduous crown, 4 bark, 5 shrub leaf, 6 mophead bloom, 7 panicle bloom,
/// 8 weed leaf, 9 green stem. Bands 2...9 let one baked wrapped mesh carry an
/// entire tree or shrub through ONE 24-byte slim instance; stems suppress wind.
/// Instanced groups whose leader carries the "~frond~" tex key swap to this.
pub const frond_wgsl = oct_decode_wgsl ++
    \\struct SceneUniforms {
    \\    vp: mat4x4f,
    \\    light_dir: vec3f,
    \\    specular_power: f32,
    \\    light_color: vec3f,
    \\    _pad1: f32,
    \\    ambient_color: vec3f,
    \\    _pad2: f32,
    \\    camera_pos: vec3f,
    \\    time: f32,
    \\    fog_color: vec3f,
    \\    fog_near: f32,
    \\    fog_far: f32,
    \\    fog_sky: f32,
    \\    wire: f32,      // 152 — wireframe flag in the shared scene uniform buffer; only scene3d_wgsl reads it (was _pad4a)
    \\    matcap: f32,    // 156 — shade by view-space normal, req_3766; only scene3d_wgsl reads it (was _pad4b)
    \\    sky_horizon: vec3f,
    \\    _pad5: f32,
    \\    sky_zenith: vec4f,
    \\};
    \\@group(0) @binding(0) var<uniform> S: SceneUniforms;
    \\@group(1) @binding(0) var diffuse_tex: texture_2d<f32>;
    \\@group(1) @binding(1) var diffuse_smp: sampler;
    \\
    \\// Slim per-instance input (the 24-byte FrondInstance, 3d.zig). The model matrix
    \\// is REBUILT here from TRS instead of shipped as 64 bytes — a frond only needs
    \\// position, pitch+yaw, one width + one length, and a tint. Decode constants MUST
    \\// match makeFrondInstance: angle deg = u16/65536*360, scale m = unorm*16.
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_angles: vec2u,   // pitch, yaw (u16 ring)
    \\    @location(5) inst_scale: vec2f,    // wide, len (unorm × 16 m)
    \\    @location(6) inst_color: vec4f,
    \\};
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) world_pos: vec3f,
    \\    @location(1) world_normal: vec3f,
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_color: vec4f,
    \\    @location(4) @interpolate(linear) screen_y: f32,
    \\};
    \\
    \\fn hash21(p: vec2f) -> f32 {
    \\    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
    \\}
    \\
    \\@vertex
    \\fn vs_main(in: VertexInput) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    let style = floor(in.uv.x * 0.1); // 10-wide bands; see flora_geometry.zig
    \\    // Rebuild model = T · Ry(yaw) · Rx(pitch) · S(wide,len,wide), column-major to
    \\    // match makeInstance's row-major T·Ry·Rx·Rz·S (rz=0) after its transpose.
    \\    let deg = 360.0 / 65536.0;
    \\    let pitch = f32(in.inst_angles.x) * deg * 0.017453292;
    \\    let yaw = f32(in.inst_angles.y) * deg * 0.017453292;
    \\    let wide = in.inst_scale.x * 16.0;
    \\    let len = in.inst_scale.y * 16.0;
    \\    let cx = cos(pitch); let sx = sin(pitch);
    \\    let cy = cos(yaw);   let sy = sin(yaw);
    \\    let mS = mat4x4f(vec4f(wide,0,0,0), vec4f(0,len,0,0), vec4f(0,0,wide,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,cx,sx,0), vec4f(0,-sx,cx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cy,0,-sy,0), vec4f(0,1,0,0), vec4f(sy,0,cy,0), vec4f(0,0,0,1));
    \\    let mT = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(in.inst_pos,1));
    \\    let model = mT * mRy * mRx * mS;
    \\    // The "spaghetti generator": a per-frond seed from the rebuilt model's rotation
    \\    // columns (constant across ONE frond's verts, varies frond-to-frond), used to
    \\    // curve each frond's BODY its own way in the local frame (y = base→tip) before
    \\    // the model transform — so no two fronds droop, sag, or bend the same.
    \\    let mc0 = model[0]; let mc2 = model[2];
    \\    let seed = hash21(vec2f(mc0.x * 3.7 + mc2.z * 1.9, mc0.z * 2.3 + mc2.x * 5.1));
    \\    let seed2 = hash21(vec2f(seed * 11.0 + 0.7, mc0.y * 4.4 + 0.3));
    \\    var pos = in.position;
    \\    let t = clamp(in.uv.y, 0.0, 1.0);   // true base→tip param (pos.y now sags via geometry)
    \\    let t2 = t * t;
    \\    let wig = sin(t * (2.5 + 4.0 * seed2) + seed2 * 6.283) + 0.45 * sin(t * (5.5 + 3.0 * seed) + seed * 3.1);
    \\    // Individual palm/broad fronds keep the spaghetti variation. Whole-tree
    \\    // meshes (styles 2+) already carry their authored wrapped silhouette;
    \\    // re-curving every component would shear the trunk and tear branch joins.
    \\    if (style < 1.5) {
    \\        pos.z = pos.z + (0.1 + 0.6 * seed) * t2;
    \\        pos.y = pos.y - (0.05 + 0.4 * seed) * t2;
    \\        pos.x = pos.x + wig * (0.16 + 0.5 * seed2) * t;
    \\    }
    \\    var world = model * vec4f(pos, 1.0);
    \\    // Tip-weighted wind: the frond base is anchored to the crown, the tip
    \\    // swings. A slower, wider sway than grass (a frond is heavy).
    \\    let tipw = pow(t, 1.4);
    \\    let phase = world.x * 0.10 + world.z * 0.12 + S.time * 1.1;
    \\    let sway = sin(phase) + 0.35 * sin(phase * 2.3 + 1.1);
    \\    let gust = 0.18 + 0.16 * sin(S.time * 0.4 + world.x * 0.04);
    \\    // req_1665: same 60m animation cut as grass (faded 50..60) — a distant palm
    \\    // crown holds still rather than paying per-vertex wind across the whole map.
    \\    let anim_fade = smoothstep(60.0, 50.0, distance(S.camera_pos, world.xyz));
    \\    var wind_weight = 1.0;
    \\    if (style >= 3.5 && style < 4.5) { wind_weight = 0.0; } // woody bark stays planted
    \\    else if (style >= 8.5) { wind_weight = 0.16; }          // green stems flex, but stay rooted
    \\    else if (style >= 1.5) { wind_weight = 0.38; }          // whole crown/shrub, not one loose frond
    \\    let bend = sway * gust * tipw * anim_fade * wind_weight;
    \\    let wind_dir = normalize(vec2f(0.8, 0.6));
    \\    world.x = world.x + wind_dir.x * bend;
    \\    world.z = world.z + wind_dir.y * bend;
    \\    world.y = world.y - abs(bend) * 0.20;
    \\    out.clip_pos = S.vp * world;
    \\    out.world_pos = world.xyz;
    \\    out.world_normal = normalize((model * vec4f(oct_decode(in.noct), 0.0)).xyz);
    \\    out.uv = in.uv;
    \\    out.inst_color = in.inst_color;
    \\    out.screen_y = out.clip_pos.y / out.clip_pos.w;
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let style = floor(in.uv.x * 0.1);        // 0 palm · 1 broad · 2 conifer · 3 crown · 4 bark · 5 shrub leaf · 6 mophead bloom · 7 panicle bloom · 8 weed leaf · 9 green stem
    \\    let u = in.uv.x - style * 10.0;          // 0..1 within the selected band
    \\    let v = clamp(in.uv.y, 0.0, 1.0);        // 0 base → 1 tip
    \\    let d = abs(u - 0.5);                // distance from the central rib
    \\    var keep = false;
    \\    if (style < 0.5) {
    \\        // Feathered coconut frond: a thin opaque rachis + leaflets that splay
    \\        // off it, each leaflet tapering and the whole frond narrowing to a tip.
    \\        let rachis = 0.06 * (1.0 - 0.5 * v);
    \\        let reach = 0.5 * (1.0 - 0.78 * v);          // frond tapers toward the tip (fuller)
    \\        let n = 28.0;                                // more leaflets per side
    \\        let cell = fract(v * n);                     // 0..1 within one leaflet
    \\        let leaflet = reach * (1.0 - 0.62 * cell);   // fatter leaflets (shrink less)
    \\        let gap = step(0.9, cell);                   // thinner seam = denser frond
    \\        keep = (d < rachis) || (d < leaflet && gap < 0.5 && v < 0.99);
    \\    } else if (style < 1.5) {
    \\        // Broad split leaf: one tapering blade with a few deep slits cut from
    \\        // the edge toward the midrib (banana/fan read).
    \\        let reach = 0.5 * (1.0 - 0.65 * v);
    \\        let slit = step(0.86, fract(v * 5.0)) * step(0.18, d); // edge-in slits
    \\        keep = (d < reach) && (slit < 0.5) && (v < 0.99);
    \\    } else if (style < 2.5) {
    \\        // Conifer spray: a tapered central branch with dense alternating
    \\        // needle breaks. Geometry repeats this plane around the trunk.
    \\        let reach = 0.5 * (1.0 - 0.74 * v);
    \\        let tooth = fract(v * 19.0 + u * 2.0);
    \\        let ragged = 0.88 + 0.12 * sin(v * 71.0 + u * 9.0);
    \\        keep = (d < 0.045) || (d < reach * ragged && tooth < 0.82 && v < 0.995);
    \\    } else if (style < 3.5) {
    \\        // Broad deciduous crown card: rounded/scalloped rather than a
    \\        // rectangular billboard. Crossed clusters form the canopy lobes.
    \\        let y = v * 2.0 - 1.0;
    \\        let round_reach = 0.5 * sqrt(max(0.0, 1.0 - y * y));
    \\        let scallop = 0.90 + 0.10 * sin(v * 31.0 + u * 17.0);
    \\        let pore = step(0.965, fract(sin(dot(floor(vec2f(u, v) * 29.0), vec2f(17.1, 31.7))) * 43758.5));
    \\        keep = d < round_reach * scallop && pore < 0.5;
    \\    } else if (style < 4.5) {
    \\        // Bark is real shared tube geometry, not a cutout card.
    \\        keep = true;
    \\    } else if (style < 5.5) {
    \\        // Hydrangea/thicket leaf: a broad ovate blade with a lightly
    \\        // serrated margin. Cards point out from the branch in 360°.
    \\        let y = v * 2.0 - 1.0;
    \\        let oval = 0.48 * pow(max(0.0, 1.0 - y * y), 0.62);
    \\        let serration = 0.91 + 0.09 * sin(v * 62.0 + u * 11.0);
    \\        keep = d < oval * serration && v > 0.015 && v < 0.985;
    \\    } else if (style < 6.5) {
    \\        // Mophead hydrangea: a round mass with a scalloped perimeter and
    \\        // pinholes between the tiny four-petal florets.
    \\        let y = v * 2.0 - 1.0;
    \\        let round_reach = 0.5 * sqrt(max(0.0, 1.0 - y * y));
    \\        let scallop = 0.88 + 0.12 * sin(v * 39.0 + u * 31.0);
    \\        let floret = fract(sin(dot(floor(vec2f(u, v) * 34.0), vec2f(19.7, 43.1))) * 43758.5);
    \\        keep = d < round_reach * scallop && floret < 0.94;
    \\    } else if (style < 7.5) {
    \\        // Panicle hydrangea: broad blush base tapering to a cream point.
    \\        // Geometry is also tapered, while this ragged cut keeps it floral.
    \\        let reach = 0.5 * (1.0 - 0.55 * v);
    \\        let petal_edge = 0.88 + 0.12 * sin(v * 51.0 + u * 27.0);
    \\        let gap = step(0.965, fract(sin(dot(floor(vec2f(u, v) * 31.0), vec2f(23.3, 37.7))) * 43758.5));
    \\        keep = d < reach * petal_edge && gap < 0.5 && v < 0.995;
    \\    } else if (style < 8.5) {
    \\        // Opportunistic weed leaf: a long lanceolate blade with uneven
    \\        // teeth, kept narrow so a stem full of cards reads airy and wild.
    \\        let spear = 0.36 * pow(max(0.0, sin(v * 3.14159265)), 0.72);
    \\        let teeth = 0.82 + 0.18 * step(0.42, fract(v * 13.0 + u * 2.0));
    \\        keep = d < spear * teeth && v > 0.01 && v < 0.99;
    \\    } else if (style < 9.5) {
    \\        // Green stems are real tapered tube geometry.
    \\        keep = true;
    \\    }
    \\    if (!keep) { discard; }
    \\    // Dark per-instance root → bright tip. Leaf families keep their
    \\    // species tint; flowers and stems select stable band palettes.
    \\    let root_col = in.inst_color.rgb;
    \\    let tip_var = hash21(floor(in.world_pos.xz * 0.5));
    \\    var tip_col = mix(vec3f(0.32, 0.55, 0.22), vec3f(0.45, 0.62, 0.20), tip_var);
    \\    if ((style >= 1.5 && style < 3.5) || (style >= 4.5 && style < 5.5) || (style >= 7.5 && style < 8.5)) {
    \\        tip_col = clamp(root_col * (1.18 + 0.18 * tip_var) + vec3f(0.025, 0.035, 0.012), vec3f(0.0), vec3f(1.0));
    \\    }
    \\    var albedo = mix(root_col, tip_col, pow(v, 0.9));
    \\    if (style >= 3.5 && style < 4.5) {
    \\        let bark_noise = hash21(floor(in.world_pos.xz * 7.0 + in.world_pos.yy));
    \\        albedo = mix(vec3f(0.13, 0.075, 0.038), vec3f(0.29, 0.19, 0.10), bark_noise);
    \\    } else if (style >= 5.5 && style < 6.5) {
    \\        let bloom_var = hash21(floor(in.world_pos.xz * 3.2 + in.world_pos.yy * 2.7));
    \\        let pink = vec3f(0.94, 0.20, 0.58);
    \\        let violet = vec3f(0.46, 0.25, 0.84);
    \\        let blue = vec3f(0.31, 0.42, 0.88);
    \\        albedo = mix(mix(pink, violet, smoothstep(0.20, 0.62, bloom_var)), blue, smoothstep(0.70, 0.96, bloom_var));
    \\        albedo = mix(albedo * 0.78, min(vec3f(1.0), albedo * 1.22 + vec3f(0.07)), v * 0.62 + tip_var * 0.16);
    \\    } else if (style >= 6.5 && style < 7.5) {
    \\        let blush = mix(vec3f(0.77, 0.22, 0.34), vec3f(0.98, 0.55, 0.62), tip_var);
    \\        let cream = mix(vec3f(0.93, 0.89, 0.68), vec3f(1.0, 0.98, 0.84), tip_var);
    \\        albedo = mix(blush, cream, smoothstep(0.08, 0.82, v));
    \\    } else if (style >= 8.5 && style < 9.5) {
    \\        albedo = clamp(root_col * (0.52 + 0.18 * v) + vec3f(0.015, 0.025, 0.005), vec3f(0.0), vec3f(1.0));
    \\    }
    \\    // Double-sided half-lambert + a touch of rib shading (darker near the rib).
    \\    let N = normalize(in.world_normal);
    \\    let L = normalize(S.light_dir);
    \\    let ndl = abs(dot(N, L)) * 0.5 + 0.5;
    \\    let solid_stem = (style >= 3.5 && style < 4.5) || (style >= 8.5 && style < 9.5);
    \\    let rib_shade = select(mix(0.82, 1.0, smoothstep(0.0, 0.12, d)), 1.0, solid_stem);
    \\    let lit = albedo * rib_shade * (S.ambient_color + S.light_color * ndl * 0.9);
    \\    let fog_t = smoothstep(S.fog_near, S.fog_far, distance(S.camera_pos, in.world_pos));
    \\    let g = clamp(in.screen_y * 0.5 + 0.5, 0.0, 1.0);
    \\    let sky_grad = mix(S.sky_horizon, S.sky_zenith.xyz, pow(g, 0.6));
    \\    let fog_target = mix(S.fog_color, sky_grad, S.fog_sky);
    \\    let final_rgb = mix(lit, fog_target, fog_t);
    \\    return vec4f(final_rgb, 1.0);
    \\}
;

/// Ground-formula mesh pipeline (the data-shape ground — GUIDING_LIGHT).
/// `Scene3D.Mesh` normally samples a baked texture; a chunk-floor mesh instead
/// runs a SURFACE FORMULA per fragment — no baked texture, crisp at any zoom,
/// O(1) memory. The shipped formula (cart/hmsc-int render3d: HEIGHTFIELD_TILE_BODY,
/// defining `fn hf_ground_rgb(uv: vec2f) -> vec3f` reading the per-cell ref stream
/// `D`) is assembled at runtime between this PREFIX and EPILOGUE:
///   scene3d_ground_prefix  +  effect_math (fbm/snoise/…)  +  <formula>  +  scene3d_ground_epilogue
/// Group 0 = the SAME SceneUniforms as scene3d (shared layout); group 1 binding 0
/// = the chunk's `D` storage buffer (the reference stream, not pixels). The vertex
/// stage and lighting/fog mirror scene3d_wgsl so a formula floor lights and fogs
/// identically to a textured one; only the base colour comes from the formula.
pub const scene3d_ground_prefix = oct_decode_wgsl ++
    \\struct SceneUniforms {
    \\    vp: mat4x4f,
    \\    light_dir: vec3f,
    \\    specular_power: f32,
    \\    light_color: vec3f,
    \\    _pad1: f32,
    \\    ambient_color: vec3f,
    \\    _pad2: f32,
    \\    camera_pos: vec3f,
    \\    time: f32,      // 124 — wrapped wall-clock the host writes each frame (was _pad3); animated ground/foliage materials read S.time
    \\    fog_color: vec3f,
    \\    fog_near: f32,
    \\    fog_far: f32,
    \\    fog_sky: f32,
    \\    wire: f32,      // 152 — wireframe flag in the shared scene uniform buffer; only scene3d_wgsl reads it (was _pad4a)
    \\    matcap: f32,    // 156 — shade by view-space normal, req_3766; only scene3d_wgsl reads it (was _pad4b)
    \\    sky_horizon: vec3f,
    \\    _pad5: f32,
    \\    sky_zenith: vec4f,
    \\};
    \\@group(0) @binding(0) var<uniform> S: SceneUniforms;
    \\@group(1) @binding(0) var<storage, read> D: array<f32>;
    \\
++ "const HF_GRID_COLS: u32 = " ++ terrain_grid.WGSL_SAMPLE_COLS ++ ";\n" ++
    "const HF_GRID_HEIGHT_OFFSET: u32 = " ++ terrain_grid.WGSL_HEIGHT_OFFSET ++ ";\n" ++
    "const HF_GRID_CELL_X_OFFSET: u32 = " ++ terrain_grid.WGSL_CELL_X_OFFSET ++ ";\n" ++
    "const HF_GRID_CELL_Z_OFFSET: u32 = " ++ terrain_grid.WGSL_CELL_Z_OFFSET ++ ";\n" ++
    "const HF_GRID_MARKER_OFFSET: u32 = " ++ terrain_grid.WGSL_MARKER_OFFSET ++ ";\n" ++
    "const HF_GRID_MARKER: u32 = " ++ terrain_grid.WGSL_TRAILER_MARKER ++ ";\n" ++
    \\fn hf_grid_active() -> bool {
    \\    return bitcast<u32>(D[HF_GRID_MARKER_OFFSET]) == HF_GRID_MARKER;
    \\}
    \\fn hf_grid_coord(local_pos: vec3f) -> vec2i {
    \\    let half = f32(HF_GRID_COLS - 1u) * 0.5;
    \\    let last = f32(HF_GRID_COLS - 1u);
    \\    let ix = i32(clamp(round(local_pos.x + half), 0.0, last));
    \\    let iz = i32(clamp(round(local_pos.z + half), 0.0, last));
    \\    return vec2i(ix, iz);
    \\}
    \\fn hf_grid_height(coord: vec2i) -> f32 {
    \\    let last = i32(HF_GRID_COLS - 1u);
    \\    let ix = u32(clamp(coord.x, 0, last));
    \\    let iz = u32(clamp(coord.y, 0, last));
    \\    return D[HF_GRID_HEIGHT_OFFSET + iz * HF_GRID_COLS + ix];
    \\}
    \\fn hf_grid_normal(coord: vec2i) -> vec3f {
    \\    let dx = max(abs(D[HF_GRID_CELL_X_OFFSET]), 0.000001);
    \\    let dz = max(abs(D[HF_GRID_CELL_Z_OFFSET]), 0.000001);
    \\    let hl = hf_grid_height(coord + vec2i(-1, 0));
    \\    let hr = hf_grid_height(coord + vec2i(1, 0));
    \\    let hu = hf_grid_height(coord + vec2i(0, -1));
    \\    let hd = hf_grid_height(coord + vec2i(0, 1));
    \\    return normalize(vec3f(-(hr - hl) / (2.0 * dx), 1.0, -(hd - hu) / (2.0 * dz)));
    \\}
    \\
++
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_euler: vec4u,
    \\    @location(5) inst_scale: vec4f,
    \\    @location(6) inst_color: vec4f,
    \\};
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) world_pos: vec3f,
    \\    @location(1) world_normal: vec3f,
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_color: vec4f,
    \\    @location(4) @interpolate(linear) screen_y: f32,
    \\};
    \\// Rebuild the model matrix from the packed instance (32-byte InstanceData) —
    \\// column-major twin of makeInstance's row-major T·Ry·Rx·Rz·S. MUST stay in sync.
    \\fn rebuild_model(inst_pos: vec3f, inst_euler: vec4u, inst_scale: vec4f) -> mat4x4f {
    \\    let a = 360.0 / 65536.0 * 0.017453292;
    \\    let rot = vec3f(f32(inst_euler.x), f32(inst_euler.y), f32(inst_euler.z)) * a;
    \\    let s = inst_scale.xyz;
    \\    let crx = cos(rot.x); let srx = sin(rot.x);
    \\    let cry = cos(rot.y); let sry = sin(rot.y);
    \\    let crz = cos(rot.z); let srz = sin(rot.z);
    \\    let mS  = mat4x4f(vec4f(s.x,0,0,0), vec4f(0,s.y,0,0), vec4f(0,0,s.z,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,crx,srx,0), vec4f(0,-srx,crx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cry,0,-sry,0), vec4f(0,1,0,0), vec4f(sry,0,cry,0), vec4f(0,0,0,1));
    \\    let mRz = mat4x4f(vec4f(crz,srz,0,0), vec4f(-srz,crz,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
    \\    let mT  = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(inst_pos,1));
    \\    return mT * mRy * mRx * mRz * mS;
    \\}
    \\@vertex
    \\fn vs_main(in: VertexInput) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    var local_position = in.position;
    \\    var local_normal = oct_decode(in.noct);
    \\    if (hf_grid_active()) {
    \\        let coord = hf_grid_coord(in.position);
    \\        local_position.x *= D[HF_GRID_CELL_X_OFFSET];
    \\        local_position.z *= D[HF_GRID_CELL_Z_OFFSET];
    \\        let grid_height = hf_grid_height(coord);
    \\        // The immutable topology is authored at y=1 for surface/top-skirt
    \\        // vertices and y=0 for skirt bottoms. Heights replace only the
    \\        // former; outward skirt normals remain topology data.
    \\        if (in.position.y > 0.5) {
    \\            local_position.y = grid_height;
    \\        } else {
    \\            // hfGen omitted skirts wholly below base. Collapse those
    \\            // bottoms to the negative surface instead of reversing them.
    \\            local_position.y = min(0.0, grid_height);
    \\        }
    \\        if (local_normal.y > 0.5) {
    \\            local_normal = hf_grid_normal(coord);
    \\        }
    \\    }
    \\    let model = rebuild_model(in.inst_pos, in.inst_euler, in.inst_scale);
    \\    let world = model * vec4f(local_position, 1.0);
    \\    out.clip_pos = S.vp * world;
    \\    out.world_pos = world.xyz;
    \\    out.world_normal = normalize((model * vec4f(local_normal, 0.0)).xyz);
    \\    out.uv = in.uv;
    \\    out.inst_color = in.inst_color;
    \\    out.screen_y = out.clip_pos.y / out.clip_pos.w;
    \\    return out;
    \\}
    \\
;

/// fs_main for the ground pipeline: base colour from the shipped formula, then
/// the SAME Blinn-Phong + aerial-fog as scene3d_wgsl (kept in step by hand —
/// any lighting change in scene3d_wgsl's fs_main must land here too).
pub const scene3d_ground_epilogue =
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let N = normalize(in.world_normal);
    \\    let L = normalize(S.light_dir);
    \\    let V = normalize(S.camera_pos - in.world_pos);
    \\    let diff = max(dot(N, L), 0.0);
    \\    let H = normalize(L + V);
    \\    let spec = pow(max(dot(N, H), 0.0), S.specular_power);
    \\    let base = in.inst_color.rgb * hf_ground_rgb(in.uv);
    \\    let ambient = S.ambient_color * base;
    \\    let diffuse = S.light_color * base * diff;
    \\    let specular = S.light_color * spec * 0.4;
    \\    let lit = ambient + diffuse + specular;
    \\    let fog_t = smoothstep(S.fog_near, S.fog_far, distance(S.camera_pos, in.world_pos));
    \\    let g = clamp(in.screen_y * 0.5 + 0.5, 0.0, 1.0);
    \\    let sky_grad = mix(S.sky_horizon, S.sky_zenith.xyz, pow(g, 0.6));
    \\    let fog_target = mix(S.fog_color, sky_grad, S.fog_sky);
    \\    let final_rgb = mix(lit, fog_target, fog_t);
    \\    let out_a = in.inst_color.a;
    \\    return vec4f(final_rgb * out_a, out_a);
    \\}
;

/// Live material region pipeline (req_3397) — faces of a model bound to a
/// catalog material evaluated per-frame over OBJECT-SPACE position, so N faces
/// sample ONE continuous animated field (no per-face restarts/seams). Module =
///   scene3d_region_prefix + effect_math + <formula> + scene3d_region_epilogue
/// The JS-composed formula must define `fn region_rgb(p: vec3f, n: vec3f) -> vec3f`
/// (p = mesh-local position, n = world normal for the triplanar blend) and may
/// read S.time and the region's D stream (spec data[] + palette + extras).
/// Same two vertex buffers as scene3d_wgsl; drawn INDEXED into the mesh's
/// retained vertices, group1 = the region's own D storage (ground BGL shape).
pub const scene3d_region_prefix = oct_decode_wgsl ++
    \\struct SceneUniforms {
    \\    vp: mat4x4f,
    \\    light_dir: vec3f,
    \\    specular_power: f32,
    \\    light_color: vec3f,
    \\    light_count: f32,
    \\    ambient_color: vec3f,
    \\    _pad2: f32,
    \\    camera_pos: vec3f,
    \\    time: f32,      // 124 — wrapped wall-clock the host writes each frame
    \\    fog_color: vec3f,
    \\    fog_near: f32,
    \\    fog_far: f32,
    \\    fog_sky: f32,
    \\    wire: f32,
    \\    _pad4b: f32,
    \\    sky_horizon: vec3f,
    \\    _pad5: f32,
    \\    sky_zenith: vec4f,
    \\};
    \\@group(0) @binding(0) var<uniform> S: SceneUniforms;
    \\@group(1) @binding(0) var<storage, read> D: array<f32>;
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) noct: vec2f, // snorm16x2 octahedral normal (oct_decode)
    \\    @location(2) uv: vec2f,
    \\    @location(3) inst_pos: vec3f,
    \\    @location(4) inst_euler: vec4u,
    \\    @location(5) inst_scale: vec4f,
    \\    @location(6) inst_color: vec4f,
    \\};
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) world_pos: vec3f,
    \\    @location(1) world_normal: vec3f,
    \\    // Mesh-local position — THE region domain. Faces are windows into one
    \\    // continuous field over this space; continuity across faces is a
    \\    // property of the domain, never of stitching.
    \\    @location(2) local_pos: vec3f,
    \\    @location(3) inst_color: vec4f,
    \\    @location(4) @interpolate(linear) screen_y: f32,
    \\};
    \\// Rebuild the model matrix from the packed instance (32-byte InstanceData) —
    \\// column-major twin of makeInstance's row-major T·Ry·Rx·Rz·S. MUST stay in sync.
    \\fn rebuild_model(inst_pos: vec3f, inst_euler: vec4u, inst_scale: vec4f) -> mat4x4f {
    \\    let a = 360.0 / 65536.0 * 0.017453292;
    \\    let rot = vec3f(f32(inst_euler.x), f32(inst_euler.y), f32(inst_euler.z)) * a;
    \\    let s = inst_scale.xyz;
    \\    let crx = cos(rot.x); let srx = sin(rot.x);
    \\    let cry = cos(rot.y); let sry = sin(rot.y);
    \\    let crz = cos(rot.z); let srz = sin(rot.z);
    \\    let mS  = mat4x4f(vec4f(s.x,0,0,0), vec4f(0,s.y,0,0), vec4f(0,0,s.z,0), vec4f(0,0,0,1));
    \\    let mRx = mat4x4f(vec4f(1,0,0,0), vec4f(0,crx,srx,0), vec4f(0,-srx,crx,0), vec4f(0,0,0,1));
    \\    let mRy = mat4x4f(vec4f(cry,0,-sry,0), vec4f(0,1,0,0), vec4f(sry,0,cry,0), vec4f(0,0,0,1));
    \\    let mRz = mat4x4f(vec4f(crz,srz,0,0), vec4f(-srz,crz,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
    \\    let mT  = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(inst_pos,1));
    \\    return mT * mRy * mRx * mRz * mS;
    \\}
    \\@vertex
    \\fn vs_main(in: VertexInput) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    let model = rebuild_model(in.inst_pos, in.inst_euler, in.inst_scale);
    \\    let world = model * vec4f(in.position, 1.0);
    \\    out.clip_pos = S.vp * world;
    \\    out.world_pos = world.xyz;
    \\    out.world_normal = normalize((model * vec4f(oct_decode(in.noct), 0.0)).xyz);
    \\    out.local_pos = in.position;
    \\    out.inst_color = in.inst_color;
    \\    out.screen_y = out.clip_pos.y / out.clip_pos.w;
    \\    return out;
    \\}
    \\
;

/// fs_main for the region pipeline: the bound material is EMISSIVE (self-lit —
/// a lavalamp's goo, a screen, a neon core), so no Blinn-Phong; aerial fog
/// still applies so the surface sits in the world like everything else.
pub const scene3d_region_epilogue =
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let rgb = region_rgb(in.local_pos, normalize(in.world_normal));
    \\    let fog_t = smoothstep(S.fog_near, S.fog_far, distance(S.camera_pos, in.world_pos));
    \\    let g = clamp(in.screen_y * 0.5 + 0.5, 0.0, 1.0);
    \\    let sky_grad = mix(S.sky_horizon, S.sky_zenith.xyz, pow(g, 0.6));
    \\    let fog_target = mix(S.fog_color, sky_grad, S.fog_sky);
    \\    let final_rgb = mix(rgb, fog_target, fog_t);
    \\    let out_a = in.inst_color.a;
    \\    return vec4f(final_rgb * out_a, out_a);
    \\}
;

/// Analytic procedural skybox. Drawn as ONE fullscreen triangle BEFORE the
/// meshes, with depth-test = always + depth-write off, so it fills the whole
/// 3D target and meshes paint over it. Every visual is driven by uniforms, so
/// the cart animates a day cycle / weather / per-zone mood just by changing
/// props each commit — there is no baked image and no cubemap.
///
/// Per-pixel: reconstruct the world-space view ray from inv(view*proj), then
///   - gradient: ground (dir.y<0) → horizon (dir.y≈0) → zenith (dir.y→1)
///   - sun: a crisp disk plus a wide power-law glow along sun_dir
///   - haze: milky lift in the horizon band (turbidity / overcast)
///   - clouds: 2-D fbm value-noise projected onto the sky dome, drifting by time
///   - stars: hashed points that fade in as `night` rises
pub const skybox_wgsl =
    \\struct SkyUniforms {
    \\    inv_vp: mat4x4f,
    \\    cam_pos: vec3f,
    \\    time: f32,
    \\    sun_dir: vec3f,
    \\    sun_size: f32,
    \\    zenith: vec3f,
    \\    haze: f32,
    \\    horizon: vec3f,
    \\    cloud: f32,
    \\    ground: vec3f,
    \\    sun_glow: f32,
    \\    sun_color: vec3f,
    \\    night: f32,
    \\};
    \\@group(0) @binding(0) var<uniform> u: SkyUniforms;
    \\
    \\struct SkyOut {
    \\    @builtin(position) clip: vec4f,
    \\    @location(0) ndc: vec2f,
    \\};
    \\
    \\@vertex
    \\fn sky_vs(@builtin(vertex_index) vid: u32) -> SkyOut {
    \\    var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    \\    var out: SkyOut;
    \\    let p = corners[vid];
    \\    out.clip = vec4f(p, 1.0, 1.0);
    \\    out.ndc = p;
    \\    return out;
    \\}
    \\
    \\fn hash21(p: vec2f) -> f32 {
    \\    let h = dot(p, vec2f(127.1, 311.7));
    \\    return fract(sin(h) * 43758.5453);
    \\}
    \\
    \\fn vnoise(p: vec2f) -> f32 {
    \\    let i = floor(p);
    \\    let f = fract(p);
    \\    let w = f * f * (3.0 - 2.0 * f);
    \\    let a = hash21(i);
    \\    let b = hash21(i + vec2f(1.0, 0.0));
    \\    let c = hash21(i + vec2f(0.0, 1.0));
    \\    let d = hash21(i + vec2f(1.0, 1.0));
    \\    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
    \\}
    \\
    \\fn fbm(p: vec2f) -> f32 {
    \\    var v = 0.0;
    \\    var amp = 0.5;
    \\    var pp = p;
    \\    for (var i: i32 = 0; i < 5; i = i + 1) {
    \\        v = v + amp * vnoise(pp);
    \\        pp = pp * 2.02;
    \\        amp = amp * 0.5;
    \\    }
    \\    return v;
    \\}
    \\
    \\@fragment
    \\fn sky_fs(in: SkyOut) -> @location(0) vec4f {
    \\    // Screen-space vertical gradient: bottom = horizon, top = zenith. Built
    \\    // off ndc.y (not the world-ray reconstruction, which renders the sky as
    \\    // the dark ground hemisphere). Guarded (sun_size >= 0 always) so the
    \\    // original ray-based body below stays compilable but unused.
    \\    if (u.sun_size >= 0.0) {
    \\        let g = clamp(in.ndc.y * 0.5 + 0.5, 0.0, 1.0);
    \\        return vec4f(mix(u.horizon, u.zenith, pow(g, 0.6)), 1.0);
    \\    }
    \\    // Reconstruct the world-space ray for this pixel.
    \\    let far = u.inv_vp * vec4f(in.ndc, 1.0, 1.0);
    \\    let world = far.xyz / far.w;
    \\    let dir = normalize(world - u.cam_pos);
    \\    let s = normalize(u.sun_dir);
    \\
    \\    // ── Vertical gradient ──
    \\    let up = clamp(dir.y, 0.0, 1.0);
    \\    let sky = mix(u.horizon, u.zenith, pow(up, 0.45));
    \\    let dn = clamp(-dir.y, 0.0, 1.0);
    \\    var col = mix(sky, u.ground, smoothstep(0.0, 0.18, dn));
    \\
    \\    // ── Haze: milky lift hugging the horizon line ──
    \\    let band = exp(-abs(dir.y) * 6.0);
    \\    col = mix(col, u.horizon * 1.18 + vec3f(0.04), band * u.haze);
    \\
    \\    // ── Stars (night only), behind clouds ──
    \\    if (u.night > 0.01 && dir.y > 0.0) {
    \\        let cell = floor(dir.xz / max(dir.y, 0.05) * 220.0);
    \\        let star = step(0.992, hash21(cell)) * step(0.5, hash21(cell + 7.3));
    \\        col = col + vec3f(star * u.night * up);
    \\    }
    \\
    \\    // ── Sun: glow then crisp disk ──
    \\    let d = dot(dir, s);
    \\    let glow = pow(max(d, 0.0), 220.0 * (1.0 - u.sun_glow) + 6.0);
    \\    col = col + u.sun_color * glow * (0.6 + u.sun_glow);
    \\    let disk = smoothstep(1.0 - u.sun_size, 1.0 - u.sun_size * 0.55, d);
    \\    col = mix(col, u.sun_color * 1.4, disk * step(0.0, s.y + 0.02));
    \\
    \\    // ── Clouds: fbm value-noise projected onto the dome, drifting ──
    \\    if (u.cloud > 0.001 && dir.y > 0.02) {
    \\        let proj = dir.xz / dir.y;
    \\        let uv = proj * 0.6 + vec2f(u.time * 0.012, u.time * 0.006);
    \\        let n = fbm(uv);
    \\        let cover = smoothstep(1.0 - u.cloud, 1.0 - u.cloud * 0.4 + 0.05, n);
    \\        let edge = fbm(uv * 3.1 + 4.0);
    \\        let mask = cover * smoothstep(0.0, 0.12, dir.y);
    \\        let lit = mix(0.55, 1.0, edge) * (0.5 + 0.5 * max(d, 0.0));
    \\        let cloud_col = mix(u.horizon * 0.7, u.sun_color * 0.5 + vec3f(0.85), lit);
    \\        col = mix(col, cloud_col, mask * 0.92);
    \\    }
    \\
    \\    return vec4f(col, 1.0);
    \\}
;

/// Polygon fill pipeline: flat-colored triangles.
/// Each instance is one triangle (3 vertex positions + RGBA color).
/// 3 vertices per instance, vertex_index selects which vertex.
pub const poly_wgsl =
    \\// ── Uniforms ───────────────────────────────────────────────────
    \\struct Globals {
    \\    screen_size: vec2f,
    \\};
    \\@group(0) @binding(0) var<uniform> globals: Globals;
    \\
    \\// ── Per-instance data: 3 vertices with per-vertex colors ──────
    \\struct TriInstance {
    \\    @location(0) v0: vec2f,     // vertex 0 position
    \\    @location(1) c0: vec4f,     // vertex 0 color
    \\    @location(2) v1: vec2f,     // vertex 1 position
    \\    @location(3) c1: vec4f,     // vertex 1 color
    \\    @location(4) v2: vec2f,     // vertex 2 position
    \\    @location(5) c2: vec4f,     // vertex 2 color
    \\};
    \\
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) color: vec4f,
    \\};
    \\
    \\@vertex
    \\fn vs_main(
    \\    @builtin(vertex_index) vertex_index: u32,
    \\    inst: TriInstance,
    \\) -> VertexOutput {
    \\    var pos: vec2f;
    \\    var col: vec4f;
    \\    if (vertex_index == 0u) {
    \\        pos = inst.v0; col = inst.c0;
    \\    } else if (vertex_index == 1u) {
    \\        pos = inst.v1; col = inst.c1;
    \\    } else {
    \\        pos = inst.v2; col = inst.c2;
    \\    }
    \\
    \\    let ndc = vec2f(
    \\        pos.x / globals.screen_size.x * 2.0 - 1.0,
    \\        1.0 - pos.y / globals.screen_size.y * 2.0,
    \\    );
    \\
    \\    var out: VertexOutput;
    \\    out.clip_pos = vec4f(ndc, 0.0, 1.0);
    \\    out.color = col;
    \\    return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    if (in.color.a <= 0.0) {
    \\        discard;
    \\    }
    \\    return vec4f(in.color.rgb * in.color.a, in.color.a);
    \\}
;
