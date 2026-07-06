// @material sandstone_strata
// @slug sandstone-strata
// @name Sandstone Strata
// @board wood_brick_stone
// @variant-labels Red Canyon, Buff Mesa, Painted Bands
// @kind surface
// @tags wood_brick_stone, sandstone, strata, desert
// @author fable-geology
fn sandstone_strata(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.55, 0.30, 0.18);
  var hi = vec3f(0.80, 0.52, 0.32);
  var pale = vec3f(0.88, 0.70, 0.50);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.60, 0.48, 0.32);
    hi = vec3f(0.80, 0.68, 0.48);
    pale = vec3f(0.90, 0.82, 0.64);
  } else if (variant >= 1.5) {
    lo = vec3f(0.52, 0.22, 0.22);
    hi = vec3f(0.82, 0.55, 0.38);
    pale = vec3f(0.92, 0.85, 0.74);
  }
  let warp = fbm(uv.x * 2.2 + seed * 0.4, uv.y * 4.0, 3.0);
  let strat = uv.y * 11.0 + warp * 0.9 + seed * 0.23;
  let band_id = floor(strat);
  let bt = rand(vec2f(band_id, floor(seed * 0.5)));
  var col = mix(lo, hi, bt);
  col = mix(col, pale, step(0.82, fract(bt * 4.7)));
  let edge = fract(strat);
  col = mix(col, lo * 0.6, smoothstep(0.09, 0.0, edge) * 0.6);
  let cross = fbm(uv.x * 9.0 + band_id * 3.0 + seed, uv.y * 30.0 + uv.x * 12.0, 3.0);
  col = col * (0.90 + cross * 0.30);
  col = mix(col, hi * 1.1, speckle(px, 2.0, seed + 5.0, 0.97) * 0.35);
  col = mix(col, lo * 0.7, sat(vertical_drips(uv, seed + 8.0, 0.6)) * 0.28);
  return sat3(col);
}
