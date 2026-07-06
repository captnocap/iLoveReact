// @material ocean_swell
// @slug ocean-swell
// @name Ocean Swell
// @board environment
// @variant-labels Noon Glass, Golden Hour, Iron Sea
// @kind surface
// @tags environment, swell, ocean
// @author fable-water_weather
fn ocean_swell(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var trough = vec3f(0.02, 0.09, 0.20);
  var crest_lit = vec3f(0.14, 0.40, 0.55);
  var glint_tone = vec3f(0.95, 0.97, 0.92);
  var band_freq = 9.0;
  if (variant > 0.5 && variant < 1.5) {
    trough = vec3f(0.10, 0.07, 0.16);
    crest_lit = vec3f(0.72, 0.38, 0.22);
    glint_tone = vec3f(1.0, 0.82, 0.55);
    band_freq = 7.0;
  } else if (variant >= 1.5) {
    trough = vec3f(0.05, 0.07, 0.09);
    crest_lit = vec3f(0.22, 0.27, 0.30);
    glint_tone = vec3f(0.70, 0.75, 0.78);
    band_freq = 12.0;
  }
  let warp = fbm(uv.x * 3.0 + seed, uv.y * 3.0 - seed, 3.0);
  let phase = (uv.x * 0.5 + uv.y) * band_freq + warp * 4.0 + seed;
  let band = sin(phase) * 0.5 + 0.5;
  var col = mix(trough, crest_lit, pow(band, 1.6));
  let chop = fbm(uv.x * 11.0 - seed, uv.y * 11.0 + seed * 0.7, 4.0) * 0.5 + 0.5;
  col = mix(col, trough, (1.0 - chop) * 0.35);
  let crest_zone = smoothstep(0.80, 0.98, band);
  let glints = speckle(px, 3.5, seed + 8.0, 0.90);
  col = mix(col, glint_tone, crest_zone * glints);
  col = mix(col, glint_tone, speckle(px, 2.0, seed + 3.0, 0.985) * 0.6);
  return sat3(col);
}
