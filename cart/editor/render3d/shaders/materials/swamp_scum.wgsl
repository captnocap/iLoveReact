// @material swamp_scum
// @slug swamp-scum
// @name Swamp Scum
// @board environment
// @variant-labels Duckweed Mat, Black Bayou, Toxic Bloom
// @kind surface
// @tags environment, algae, swamp
// @author fable-water_weather
fn swamp_scum(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var murk = vec3f(0.07, 0.10, 0.06);
  var scum_tone = vec3f(0.34, 0.48, 0.14);
  var scum_lit = vec3f(0.52, 0.62, 0.22);
  var cover = 0.5;
  if (variant > 0.5 && variant < 1.5) {
    murk = vec3f(0.05, 0.05, 0.05);
    scum_tone = vec3f(0.18, 0.26, 0.10);
    scum_lit = vec3f(0.30, 0.36, 0.16);
    cover = 0.30;
  } else if (variant >= 1.5) {
    murk = vec3f(0.08, 0.12, 0.10);
    scum_tone = vec3f(0.42, 0.66, 0.20);
    scum_lit = vec3f(0.66, 0.84, 0.30);
    cover = 0.68;
  }
  let ripple = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 3.0) * 0.5 + 0.5;
  var col = murk * (0.7 + 0.6 * ripple);
  let mat_n = fbm(uv.x * 6.5 - seed, uv.y * 6.5 + seed * 0.7, 4.0) * 0.5 + 0.5;
  let mat_mask = smoothstep(1.0 - cover - 0.18, 1.0 - cover + 0.18, mat_n);
  var scum = mix(scum_tone, scum_lit, fbm(uv.x * 14.0 + seed, uv.y * 14.0, 3.0) * 0.5 + 0.5);
  let fleck = speckle(px, 2.0, seed + 3.0, 0.88);
  scum = mix(scum, scum_lit * 1.2, fleck * 0.5);
  col = mix(col, scum, mat_mask);
  let vor = voronoi(uv.x * 16.0 + seed, uv.y * 16.0 - seed);
  let bubble = smoothstep(0.10, 0.05, vor.x) * step(0.75, rand(vec2f(vor.y, seed + 7.0))) * (1.0 - mat_mask);
  col = mix(col, murk * 1.8 + vec3f(0.06, 0.08, 0.05), bubble);
  col = mix(col, vec3f(0.55, 0.62, 0.48), smoothstep(0.03, 0.0, vor.x) * step(0.75, rand(vec2f(vor.y, seed + 7.0))) * (1.0 - mat_mask) * 0.7);
  let sheen = line_near(sin(uv.x * 12.0 + seed) * sin(uv.y * 10.0 - seed), 0.12) * (1.0 - mat_mask);
  col = col + vec3f(0.04, 0.05, 0.03) * sheen;
  return sat3(col);
}
