// @material geyser_steam
// @slug geyser-steam
// @name Geyser Steam
// @board environment
// @variant-labels Sulfur Terrace, Chalk Basin, Dusk Vent
// @kind composition
// @tags environment, geyser, steam
// @author fable-water_weather
fn geyser_steam(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var mineral_a = vec3f(0.88, 0.82, 0.68);
  var mineral_b = vec3f(0.80, 0.50, 0.20);
  var basin = vec3f(0.30, 0.60, 0.62);
  var steam_tone = vec3f(0.92, 0.94, 0.95);
  if (variant > 0.5 && variant < 1.5) {
    mineral_a = vec3f(0.90, 0.88, 0.84);
    mineral_b = vec3f(0.66, 0.62, 0.55);
    basin = vec3f(0.42, 0.66, 0.70);
  } else if (variant >= 1.5) {
    mineral_a = vec3f(0.52, 0.40, 0.38);
    mineral_b = vec3f(0.36, 0.22, 0.26);
    basin = vec3f(0.20, 0.36, 0.44);
    steam_tone = vec3f(0.72, 0.68, 0.74);
  }
  let warp = fbm(uv.x * 4.0 + seed, uv.y * 4.0 - seed, 3.0) * 0.35;
  let terr = uv.y + warp;
  let band = fract(terr * 5.0 + seed * 0.1);
  let step_edge = smoothstep(0.0, 0.15, band) * (1.0 - smoothstep(0.85, 1.0, band));
  var col = mix(mineral_b, mineral_a, step_edge);
  let wet = smoothstep(0.45, 0.75, fbm(uv.x * 6.0 - seed, uv.y * 6.0 + seed, 3.0) * 0.5 + 0.5);
  col = mix(col, basin, wet * step_edge * 0.8);
  let crust = speckle(px, 2.5, seed + 2.0, 0.90);
  col = mix(col, mineral_a * 1.1, crust * 0.4);
  var puff = 0.0;
  puff = max(puff, blotch(uv, vec2f(0.34, 0.30), 0.22, vec2f(0.7, 0.7), seed + 4.0));
  puff = max(puff, blotch(uv, vec2f(0.68, 0.55), 0.18, vec2f(0.8, 0.8), seed + 8.0));
  let billow = fbm(uv.x * 7.0 + seed, uv.y * 7.0 - seed * 0.5, 3.0) * 0.5 + 0.5;
  col = mix(col, steam_tone, smoothstep(0.25, 0.7, puff * billow * 1.6) * 0.85);
  return sat3(col);
}
