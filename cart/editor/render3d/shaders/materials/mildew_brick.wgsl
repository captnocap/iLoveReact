// @material mildew_brick
// @slug mildew-brick
// @name Mildew Brick
// @board condemned
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags condemned, mildew, brick
// @author legacy
fn mildew_brick(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = brick(uv, px, 1.0, seed);
  let damp = smoothstep(0.40, 0.96, uv.y);
  let green = smoothstep(0.42, 0.70, fbm(uv.x * 6.0 + seed, uv.y * 9.0, 5.0) * 0.5 + 0.5) * damp;
  let black = smoothstep(0.64, 0.90, fbm(uv.x * 12.0 - seed, uv.y * 8.0 + seed, 4.0) * 0.5 + 0.5) * (0.4 + variant * 0.3);
  col = mix(col, vec3f(0.050, 0.12, 0.045), green * 0.62);
  col = mix(col, vec3f(0.030, 0.025, 0.020), black * 0.44);
  return sat3(mix(col, vec3f(0.82, 0.80, 0.68), speckle(px, 6.0, seed, 0.94) * smoothstep(1.0, 1.8, variant) * 0.58));
}
