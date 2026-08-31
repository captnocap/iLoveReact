// @material brick
// @slug brick
// @name Brick
// @board environment
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags environment, brick
// @author legacy
//
// Appearance adapter over surface_brick (Surface Packages v1): the structural
// cell/mortar/tone math lives in surfaces/surface_brick.wgsl and this fn
// shades its features — pixel-identical to the pre-extraction inline version
// (same ops, same order, same values), with soot/chips staying appearance-side.
fn brick(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rows = 6.0 + variant;
  let cols = 3.2 + variant * 0.55;
  let s = surface_brick(vec2f(uv.x * cols, uv.y * rows), seed);
  let cell = s.cell;
  let mortar = s.feat.x;
  let tone = s.feat.y;
  let near_x = s.feat.z;
  let near_y = s.feat.w;
  let soot = fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5;
  var a = vec3f(0.45, 0.13, 0.075);
  var b = vec3f(0.82, 0.31, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    a = vec3f(0.30, 0.105, 0.085);
    b = vec3f(0.62, 0.20, 0.13);
  } else if (variant >= 1.5) {
    a = vec3f(0.58, 0.42, 0.31);
    b = vec3f(0.84, 0.62, 0.45);
  }
  var col = mix(a, b, tone * 0.65 + soot * 0.35);
  let chip = speckle(px + cell * 9.0, 5.0, seed, 0.935) * smoothstep(0.10, 0.22, near_x) * smoothstep(0.10, 0.22, near_y);
  col = mix(col, vec3f(0.18, 0.12, 0.10), chip * 0.34);
  col = mix(col, vec3f(0.55, 0.53, 0.48), mortar * (0.88 - variant * 0.08));
  return sat3(col);
}
