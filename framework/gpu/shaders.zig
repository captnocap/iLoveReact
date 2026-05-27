//! WGSL shader source for the tsz wgpu renderer.
//!
//! SDF-based rounded rectangles with borders, anti-aliasing,
//! gradients, and shadows — all in the fragment shader.
//! Glyph atlas text rendering with per-glyph color tinting.
//! SDF quadratic bezier curves with anti-aliased strokes.

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
    \\struct CurveInstance {
    \\    @location(0) p0: vec2f,           // start point (screen pixels)
    \\    @location(1) p1: vec2f,           // control point
    \\    @location(2) p2: vec2f,           // end point
    \\    @location(3) color: vec4f,        // stroke RGBA [0..1]
    \\    @location(4) stroke_width: f32,   // stroke thickness in pixels
    \\    @location(5) dash_len: f32,       // t-space dash period (0 = solid)
    \\    @location(6) gap_ratio: f32,      // fraction that is gap (0.5 = equal)
    \\    @location(7) time_offset: f32,    // animated offset for flow
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
    \\    @location(6) dash_len: f32,
    \\    @location(7) gap_ratio: f32,
    \\    @location(8) time_offset: f32,
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
    \\    out.dash_len = inst.dash_len;
    \\    out.gap_ratio = inst.gap_ratio;
    \\    out.time_offset = inst.time_offset;
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
    \\    let t = result.y;
    \\    let half_w = in.stroke_width * 0.5;
    \\
    \\    // Anti-aliased stroke: smooth falloff over 1px at the edge
    \\    let alpha = 1.0 - smoothstep(half_w - 1.0, half_w + 0.5, dist);
    \\
    \\    if alpha <= 0.0 {
    \\        discard;
    \\    }
    \\
    \\    var final_alpha = in.color.a * alpha;
    \\
    \\    // Animated dash pattern
    \\    if in.dash_len > 0.0 {
    \\        let pattern = fract((t + in.time_offset) / in.dash_len);
    \\        let edge = 0.04;
    \\        let threshold = 1.0 - in.gap_ratio;
    \\        let dash_alpha = smoothstep(threshold - edge, threshold + edge, pattern);
    \\        final_alpha *= (1.0 - dash_alpha);
    \\    }
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
    \\struct CapsuleInstance {
    \\    @location(0) p0: vec2f,
    \\    @location(1) p1: vec2f,
    \\    @location(2) color: vec4f,
    \\    @location(3) stroke_width: f32,
    \\    @location(4) _pad0: f32,
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

/// 3D mesh pipeline: perspective projection + Blinn-Phong lighting.
/// Vertex: position(vec3f), normal(vec3f), uv(vec2f) = 32 bytes.
/// Uniforms: MVP, model matrix, lighting, material color.
pub const scene3d_wgsl =
    \\// ── Uniforms ───────────────────────────────────────────────────
    \\struct SceneUniforms {
    \\    mvp: mat4x4f,
    \\    model: mat4x4f,
    \\    light_dir: vec3f,
    \\    specular_power: f32,
    \\    light_color: vec3f,
    \\    _pad1: f32,
    \\    ambient_color: vec3f,
    \\    _pad2: f32,
    \\    camera_pos: vec3f,
    \\    _pad3: f32,
    \\    color: vec4f,
    \\    fog_color: vec3f,
    \\    fog_near: f32,
    \\    fog_far: f32,
    \\    _pad4: vec4f,
    \\};
    \\@group(0) @binding(0) var<uniform> u: SceneUniforms;
    \\@group(1) @binding(0) var diffuse_tex: texture_2d<f32>;
    \\@group(1) @binding(1) var diffuse_smp: sampler;
    \\
    \\// ── Vertex I/O ────────────────────────────────────────────────
    \\struct VertexInput {
    \\    @location(0) position: vec3f,
    \\    @location(1) normal: vec3f,
    \\    @location(2) uv: vec2f,
    \\};
    \\
    \\struct VertexOutput {
    \\    @builtin(position) clip_pos: vec4f,
    \\    @location(0) world_pos: vec3f,
    \\    @location(1) world_normal: vec3f,
    \\    @location(2) uv: vec2f,
    \\};
    \\
    \\// ── Vertex shader ────────────────────────────────────────────
    \\@vertex
    \\fn vs_main(in: VertexInput) -> VertexOutput {
    \\    var out: VertexOutput;
    \\    out.clip_pos = u.mvp * vec4f(in.position, 1.0);
    \\    out.world_pos = (u.model * vec4f(in.position, 1.0)).xyz;
    \\    out.world_normal = normalize((u.model * vec4f(in.normal, 0.0)).xyz);
    \\    out.uv = in.uv;
    \\    return out;
    \\}
    \\
    \\// ── Fragment shader (Blinn-Phong + diffuse texture) ──────────
    \\// Meshes without an explicit texture get a 1×1 white default,
    \\// so the multiply collapses to the uniform color and behavior
    \\// matches the pre-texture pipeline.
    \\@fragment
    \\fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    \\    let N = normalize(in.world_normal);
    \\    let L = normalize(u.light_dir);
    \\    let V = normalize(u.camera_pos - in.world_pos);
    \\
    \\    // Diffuse (Lambert)
    \\    let diff = max(dot(N, L), 0.0);
    \\
    \\    // Specular (Blinn-Phong)
    \\    let H = normalize(L + V);
    \\    let spec = pow(max(dot(N, H), 0.0), u.specular_power);
    \\
    \\    let tex_sample = textureSample(diffuse_tex, diffuse_smp, in.uv);
    \\    let base = u.color.rgb * tex_sample.rgb;
    \\    let ambient = u.ambient_color * base;
    \\    let diffuse = u.light_color * base * diff;
    \\    let specular = u.light_color * spec * 0.4;
    \\    let lit = ambient + diffuse + specular;
    \\    let fog_t = smoothstep(u.fog_near, u.fog_far, distance(u.camera_pos, in.world_pos));
    \\    let final_rgb = mix(lit, u.fog_color, fog_t);
    \\
    \\    return vec4f(final_rgb, u.color.a * tex_sample.a);
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
