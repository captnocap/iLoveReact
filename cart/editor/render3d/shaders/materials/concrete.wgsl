// @material concrete
// @slug concrete
// @name Concrete
// @board environment
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags environment, concrete
// @author legacy
fn concrete(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let cloud = fbm(uv.x * 7.0 + seed * 0.7, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5;
  let trowel = sin((uv.x * 0.9 + uv.y * 1.6 + fbm(uv.x * 2.5, uv.y * 2.5 + seed, 3.0) * 0.18) * 24.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.40, 0.405, 0.390), vec3f(0.72, 0.72, 0.68), cloud) + vec3f(trowel * 0.035);
  if (variant < 0.5) {
    col = col + vec3f(line_near(sin((uv.x + fbm(uv.x * 2.0, uv.y * 4.0, 3.0) * 0.03) * 95.0), 0.16) * 0.035);
  } else if (variant < 1.5) {
    col = col - vec3f(sat(line_near(uv.x - 0.50, 0.010) + line_near(uv.y - 0.50, 0.010)) * 0.12);
  } else {
    col = col - vec3f(crack_field(uv, seed, 7.5) * 0.18);
  }
  col = col - vec3f(speckle(px, 4.5, seed, 0.91) * 0.075) + vec3f(speckle(px + vec2f(11.0, 23.0), 6.5, seed, 0.965) * 0.065);
  return sat3(col);
}
