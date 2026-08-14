// @material fog_bank
// @slug fog-bank
// @name Fog Bank
// @board environment
// @variant-labels Valley Morning, Harbor Grey, Dusk Smother
// @kind gradient
// @tags environment, fog, haze
// @author fable-water_weather
fn fog_bank(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var fog_hi = vec3f(0.86, 0.88, 0.90);
  var fog_lo = vec3f(0.64, 0.70, 0.72);
  var ground = vec3f(0.10, 0.14, 0.10);
  var tint = vec3f(0.78, 0.82, 0.74);
  if (variant > 0.5 && variant < 1.5) {
    fog_hi = vec3f(0.70, 0.73, 0.76);
    fog_lo = vec3f(0.52, 0.56, 0.60);
    ground = vec3f(0.08, 0.09, 0.11);
    tint = vec3f(0.60, 0.64, 0.70);
  } else if (variant >= 1.5) {
    fog_hi = vec3f(0.66, 0.54, 0.56);
    fog_lo = vec3f(0.38, 0.30, 0.40);
    ground = vec3f(0.09, 0.06, 0.10);
    tint = vec3f(0.72, 0.52, 0.50);
  }
  var col = mix(fog_hi, fog_lo, uv.y);
  var dens = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    let fi = f32(i);
    let layer = fbm(uv.x * (1.5 + fi * 1.2) + seed + fi * 9.0, uv.y * (5.0 + fi * 3.0) - seed * 0.4, 3.0) * 0.5 + 0.5;
    let band_y = 0.25 + fi * 0.18;
    let band = smoothstep(0.28, 0.0, abs(uv.y - band_y + (layer - 0.5) * 0.3));
    dens = dens + band * layer * (0.40 - fi * 0.06);
  }
  col = mix(col, tint, sat(dens) * 0.6);
  let ground_line = smoothstep(0.72, 0.95, uv.y + (fbm(uv.x * 5.0 + seed, seed, 3.0)) * 0.15);
  let scrub = fbm(uv.x * 12.0 - seed, uv.y * 12.0, 3.0) * 0.5 + 0.5;
  col = mix(col, ground * (0.7 + 0.6 * scrub), ground_line);
  let wisp = smoothstep(0.55, 0.90, fbm(uv.x * 2.5 + seed * 0.7, uv.y * 6.0 + seed, 3.0) * 0.5 + 0.5) * ground_line;
  col = mix(col, fog_lo, wisp * 0.7);
  col = mix(col, fog_hi, speckle(px, 3.0, seed + 2.0, 0.985) * 0.4);
  return sat3(col);
}
