// @material moon_surface
// @slug moon-surface
// @name Moon Surface
// @board gradients
// @variant-labels Near Side, Bright Highlands, Dark Maria
// @kind surface
// @tags gradients, moon, craters, space
// @author fable-sky_space
fn moon_surface(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.38, 0.38, 0.40);
  var hi = vec3f(0.62, 0.61, 0.58);
  var mariaTone = vec3f(0.26, 0.27, 0.30);
  var mariaAmt = 0.55;
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.52, 0.51, 0.48); hi = vec3f(0.78, 0.77, 0.72); mariaTone = vec3f(0.40, 0.40, 0.42); mariaAmt = 0.25;
  } else if (variant >= 1.5) {
    lo = vec3f(0.22, 0.23, 0.26); hi = vec3f(0.42, 0.42, 0.44); mariaTone = vec3f(0.13, 0.14, 0.17); mariaAmt = 0.75;
  }
  let mottle = fbm(uv.x * 6.0 + seed, uv.y * 6.0 - seed * 0.5, 5.0) + 0.5;
  var col = mix(lo, hi, mottle);
  let maria = smoothstep(0.55, 0.80, fbm(uv.x * 2.0 + seed * 0.7, uv.y * 2.0 + 3.0, 4.0) + 0.5);
  col = mix(col, mariaTone, maria * mariaAmt);
  let big = voronoi(uv.x * 5.0 + seed, uv.y * 5.0);
  let bigRim = smoothstep(0.24, 0.33, big.x) * smoothstep(0.46, 0.35, big.x);
  let bigPit = smoothstep(0.26, 0.04, big.x);
  col = col + hi * bigRim * 0.35 - vec3f(0.14, 0.14, 0.15) * bigPit;
  let small = voronoi(uv.x * 14.0 - seed, uv.y * 14.0 + seed * 0.3);
  let smallRim = smoothstep(0.16, 0.24, small.x) * smoothstep(0.34, 0.25, small.x);
  let smallPit = smoothstep(0.18, 0.02, small.x);
  col = col + hi * smallRim * 0.20 - vec3f(0.10, 0.10, 0.11) * smallPit * 0.8;
  col = col + vec3f(0.20, 0.20, 0.19) * speckle(px, 1.4, seed, 0.955) - vec3f(0.12, 0.12, 0.13) * speckle(px, 2.0, seed + 9.0, 0.965);
  return sat3(col);
}
