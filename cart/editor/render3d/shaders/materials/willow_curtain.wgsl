// @material willow_curtain
// @slug willow-curtain
// @name Willow Curtain
// @board environment
// @variant-labels Spring Veil, Deep Summer, Golden October
// @kind surface
// @tags environment, willow, tree
// @author fable-botanic
fn willow_curtain(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var shade_bg = vec3f(0.04, 0.10, 0.05);
  var strand_lo = vec3f(0.16, 0.34, 0.12);
  var strand_hi = vec3f(0.46, 0.66, 0.28);
  if (variant > 0.5 && variant < 1.5) {
    shade_bg = vec3f(0.02, 0.07, 0.04);
    strand_lo = vec3f(0.09, 0.24, 0.09);
    strand_hi = vec3f(0.26, 0.48, 0.17);
  } else if (variant >= 1.5) {
    shade_bg = vec3f(0.08, 0.06, 0.03);
    strand_lo = vec3f(0.38, 0.30, 0.10);
    strand_hi = vec3f(0.72, 0.60, 0.22);
  }
  let dim = fbm(uv.x * 3.0 + seed, uv.y * 3.0, 3.0) * 0.5 + 0.5;
  var col = shade_bg * (0.7 + dim * 0.6);
  let sway = sin(uv.y * 3.0 + U.time * 0.4 + seed) * 0.035;
  let backx = uv.x + sway * 0.5 + snoise(uv.x * 2.0 + seed, uv.y * 1.5) * 0.02;
  let back = line_near(sin(backx * 120.0 + seed * 3.0), 0.30);
  col = mix(col, strand_lo * 0.7, back * 0.7);
  let frontx = uv.x + sway + snoise(uv.x * 2.5 + seed * 1.3, uv.y * 2.0) * 0.03;
  let front = line_near(sin(frontx * 74.0 + seed), 0.22);
  let droop = smoothstep(0.0, 0.35, uv.y);
  col = mix(col, mix(strand_lo, strand_hi, dim), front * droop);
  let leafflick = speckle(px, 3.0, seed + 8.0, 0.90) * front;
  col = mix(col, strand_hi * 1.1, leafflick);
  let gleam = pow(sat(sin(frontx * 74.0 + seed) * 0.5 + 0.5), 6.0);
  col = col + vec3f(0.08, 0.10, 0.04) * gleam * droop * 0.6;
  return sat3(col);
}
