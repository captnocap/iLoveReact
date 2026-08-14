// @material malachite_bands
// @slug malachite-bands
// @name Malachite Bands
// @board neon_surface
// @variant-labels Deep Forest, Bright Verde, Velvet Night
// @kind surface
// @tags neon_surface, malachite, green, banded
// @author fable-gems_precious
fn malachite_bands(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.03, 0.20, 0.11);
  var hi = vec3f(0.20, 0.65, 0.38);
  var silk = vec3f(0.55, 0.88, 0.66);
  var freq = 42.0;
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.06, 0.32, 0.18); hi = vec3f(0.34, 0.80, 0.48); freq = 26.0;
  } else if (variant >= 1.5) {
    lo = vec3f(0.01, 0.10, 0.06); hi = vec3f(0.10, 0.42, 0.26);
    silk = vec3f(0.30, 0.62, 0.44); freq = 58.0;
  }
  let c1 = vec2f(0.25 + rand(vec2f(seed, 1.0)) * 0.3, 0.30 + rand(vec2f(seed, 2.0)) * 0.3);
  let c2 = vec2f(0.60 + rand(vec2f(seed, 3.0)) * 0.3, 0.65 + rand(vec2f(seed, 4.0)) * 0.3);
  let warp = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.08;
  let d = min(length(uv - c1), length(uv - c2)) + warp;
  let wave = sin(d * freq + seed) * 0.5 + 0.5;
  let band_step = floor(wave * 4.0) / 4.0;
  var col = mix(lo, hi, band_step * 0.7 + wave * 0.3);
  let silk_m = line_near(sin(d * freq * 2.0 + 1.3), 0.10);
  col = mix(col, silk, silk_m * 0.28);
  let mottle = fbm(uv.x * 18.0, uv.y * 18.0 + seed * 1.4, 4.0) * 0.5 + 0.5;
  col = mix(col * 0.85, col * 1.10, mottle);
  col = mix(col, lo * 0.6, crack_field(uv, seed + 11.0, 4.0) * 0.25);
  return sat3(col);
}
