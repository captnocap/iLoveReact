// @material rain_glass
// @slug rain-glass
// @name Rain Glass
// @board environment
// @variant-labels Neon Night, Grey Noon, Dusk Amber
// @kind surface
// @tags environment, rain, window
// @author fable-water_weather
fn rain_glass(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sky_top = vec3f(0.05, 0.04, 0.12);
  var sky_low = vec3f(0.30, 0.10, 0.28);
  var bead_glow = vec3f(0.85, 0.60, 0.90);
  if (variant > 0.5 && variant < 1.5) {
    sky_top = vec3f(0.55, 0.60, 0.64);
    sky_low = vec3f(0.38, 0.42, 0.46);
    bead_glow = vec3f(0.88, 0.92, 0.95);
  } else if (variant >= 1.5) {
    sky_top = vec3f(0.16, 0.10, 0.20);
    sky_low = vec3f(0.70, 0.38, 0.18);
    bead_glow = vec3f(0.98, 0.78, 0.50);
  }
  let blur = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.12;
  var col = mix(sky_top, sky_low, sat(uv.y + blur));
  let streak = vertical_drips(uv, seed, 0.8);
  col = mix(col, sky_low * 1.3 + vec3f(0.08, 0.09, 0.10), streak * 0.5);
  let vor = voronoi(uv.x * 22.0 + seed, uv.y * 30.0 - seed);
  let bead_r = 0.10 + rand(vec2f(vor.y, seed)) * 0.14;
  let keep = step(0.45, rand(vec2f(vor.y * 1.7, seed + 5.0)));
  let bead = smoothstep(bead_r, bead_r - 0.08, vor.x) * keep;
  let hilite = smoothstep(0.06, 0.0, vor.x) * keep;
  col = mix(col, mix(sky_top, sky_low, 0.8) * 0.6 + vec3f(0.10, 0.11, 0.13), bead * 0.75);
  col = mix(col, bead_glow, hilite * 0.8);
  let fog_edge = smoothstep(0.55, 1.0, uv.y) * (fbm(uv.x * 8.0, uv.y * 8.0 + seed, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.62, 0.66, 0.70), fog_edge * 0.25);
  return sat3(col);
}
