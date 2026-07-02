// @material mold_wall
// @slug mold-wall
// @name Mold Wall
// @board condemned
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags condemned, mold, wall
// @author legacy
fn mold_wall(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let paper = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.35, 0.32, 0.25), vec3f(0.70, 0.65, 0.52), paper);
  col = mix(col, vec3f(0.54, 0.42, 0.27), 0.22 + variant * 0.10);
  let mold = sat(blotch(uv, vec2f(0.24, 0.68), 0.18 + variant * 0.03, vec2f(1.2, 0.8), seed) + blotch(uv, vec2f(0.74, 0.33), 0.15, vec2f(0.8, 1.4), seed + 4.0));
  col = mix(col, vec3f(0.045, 0.090, 0.045), mold * 0.74);
  col = mix(col, vec3f(0.23, 0.19, 0.13), line_near(length((uv - vec2f(0.30, 0.30)) * vec2f(1.0, 1.25)) - 0.23, 0.022) * (0.35 + variant * 0.15));
  col = col - vec3f(vertical_drips(uv, seed, variant) * 0.22 + crack_field(uv, seed, 6.0) * 0.18 + speckle(px, 2.0, seed, 0.92) * 0.10);
  return sat3(col);
}
