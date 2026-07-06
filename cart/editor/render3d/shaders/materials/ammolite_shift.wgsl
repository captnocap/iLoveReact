// @material ammolite_shift
// @slug ammolite-shift
// @name Ammolite Shift
// @board neon_surface
// @variant-labels Dragon Scale, Rare Blue, Ember Fossil
// @kind surface
// @tags neon_surface, ammolite, rainbow, banded
// @author fable-gems_precious
fn ammolite_shift(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var band_a = vec3f(0.85, 0.20, 0.10);
  var band_b = vec3f(0.95, 0.62, 0.08);
  var band_c = vec3f(0.16, 0.62, 0.24);
  var seam = vec3f(0.12, 0.08, 0.06);
  if (variant > 0.5 && variant < 1.5) {
    band_a = vec3f(0.08, 0.30, 0.68); band_b = vec3f(0.14, 0.62, 0.66); band_c = vec3f(0.40, 0.24, 0.62);
    seam = vec3f(0.05, 0.06, 0.10);
  } else if (variant >= 1.5) {
    band_a = vec3f(0.62, 0.10, 0.06); band_b = vec3f(0.88, 0.42, 0.10); band_c = vec3f(0.70, 0.58, 0.14);
    seam = vec3f(0.16, 0.09, 0.05);
  }
  let warp = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 4.0) * 0.35;
  let bx = uv.x * 9.0 + warp * 3.0 + seed * 0.13;
  let bid = floor(bx);
  let pick = fract(rand(vec2f(bid, seed * 0.07)) * 3.0);
  var col = band_a;
  if (pick > 0.6666) { col = band_c; }
  else if (pick > 0.3333) { col = band_b; }
  let bf = fract(bx);
  col = mix(col * 0.7, col * 1.2, smoothstep(0.0, 0.45, bf) * smoothstep(1.0, 0.55, bf));
  let shimmer = fbm(uv.x * 24.0, uv.y * 24.0 + seed * 1.7, 3.0) * 0.5 + 0.5;
  col = mix(col * 0.85, col * 1.15, shimmer);
  let cr = crack_field(uv, seed + 13.0, 5.0);
  col = mix(col, seam, sat(cr * 1.4) * 0.7);
  let gloss = exp(-pow((uv.y - 0.3 - warp * 0.3) * 4.5, 2.0));
  col = mix(col, vec3f(1.0, 0.95, 0.85), gloss * 0.22);
  return sat3(col);
}
