// @material denim
// @slug denim
// @name Denim
// @board props
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags props, denim
// @author legacy
fn denim(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let weave_a = line_near(sin((uv.x + uv.y * 0.62) * (106.0 + variant * 12.0)), 0.13);
  let weave_b = line_near(sin((uv.y - uv.x * 0.20) * (82.0 + variant * 8.0)), 0.11);
  let fade = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 4.0) * 0.5 + 0.5;
  var low = vec3f(0.025, 0.075, 0.18);
  var high = vec3f(0.18, 0.35, 0.62);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.020, 0.024, 0.032);
    high = vec3f(0.18, 0.20, 0.24);
  } else if (variant >= 1.5) {
    low = vec3f(0.18, 0.23, 0.30);
    high = vec3f(0.56, 0.66, 0.76);
  }
  var col = mix(low, high, fade * 0.48 + weave_a * 0.18 + weave_b * 0.10);
  let fray = line_near(snoise(uv.x * 20.0 + seed, uv.y * 6.0 - seed), 0.020) * smoothstep(0.55, 0.94, uv.x);
  let lint = speckle(px, 3.0, seed, 0.92);
  col = mix(col, vec3f(0.72, 0.78, 0.82), fray * 0.36 + lint * 0.18);
  return sat3(col);
}
