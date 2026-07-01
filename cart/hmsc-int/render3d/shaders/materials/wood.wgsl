// @material wood
// @slug wood
// @name Wood
// @board environment
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags environment, wood
// @author legacy
fn wood(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var low = vec3f(0.38, 0.18, 0.070);
  var high = vec3f(0.80, 0.47, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.18, 0.095, 0.055);
    high = vec3f(0.52, 0.30, 0.15);
  } else if (variant >= 1.5) {
    low = vec3f(0.52, 0.34, 0.16);
    high = vec3f(0.92, 0.72, 0.40);
  }
  var grain = 0.0;
  if (variant < 1.5) {
    let warp = fbm(uv.x * 4.0 + seed, uv.y * 10.0 - seed, 5.0);
    let x = uv.x + warp * 0.075 + sin(uv.y * 9.0 + seed) * 0.015;
    grain = sin(x * (54.0 + variant * 22.0) + fbm(uv.x * 13.0, uv.y * 4.0 + seed, 3.0) * 7.0) * 0.5 + 0.5;
  } else {
    let p = uv - vec2f(0.50, 0.50);
    grain = sin(length(p * vec2f(1.0, 1.12)) * 92.0 + fbm(uv.x * 12.0, uv.y * 12.0 + seed, 4.0) * 7.0) * 0.5 + 0.5;
  }
  var col = mix(low, high, grain * 0.72 + 0.16);
  col = col - vec3f(0.10, 0.07, 0.035) * speckle(px, 3.0, seed, 0.945);
  col = col + vec3f(line_near(sin(uv.x * 220.0 + seed), 0.10) * 0.025);
  return sat3(col);
}
