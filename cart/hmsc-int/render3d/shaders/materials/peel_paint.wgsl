// @material peel_paint
// @slug peel-paint
// @name Peel Paint
// @board condemned
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags condemned, peel, paint
// @author legacy
fn peel_paint(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var top_col = vec3f(0.62, 0.67, 0.55);
  var under_col = vec3f(0.36, 0.25, 0.18);
  if (variant > 0.5 && variant < 1.5) {
    top_col = vec3f(0.30, 0.48, 0.43);
    under_col = vec3f(0.67, 0.55, 0.38);
  } else if (variant >= 1.5) {
    top_col = vec3f(0.68, 0.58, 0.42);
    under_col = vec3f(0.18, 0.16, 0.14);
  }
  let grain = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 5.0) * 0.5 + 0.5;
  let peel = smoothstep(0.44, 0.59, fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 5.0) * 0.5 + 0.5);
  var col = mix(top_col, under_col, peel);
  col = col + vec3f(0.10, 0.09, 0.07) * line_near(fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0), 0.035) * peel;
  col = col - vec3f(0.11, 0.09, 0.07) * vertical_drips(uv, seed + 2.0, 1.0);
  col = mix(col, vec3f(0.035, 0.070, 0.035), blotch(uv, vec2f(0.76, 0.72), 0.17, vec2f(1.0, 0.9), seed) * 0.46);
  col = col + vec3f((grain - 0.5) * 0.08) - vec3f(speckle(px, 3.0, seed, 0.90) * 0.08);
  return sat3(col);
}
