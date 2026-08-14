// @material ocean_foam
// @slug ocean-foam
// @name Ocean Foam
// @board environment
// @variant-labels Lace Tide, Tropic Wash, Cold Churn
// @kind surface
// @tags environment, foam, sea
// @author fable-water_weather
fn ocean_foam(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sea_deep = vec3f(0.03, 0.22, 0.28);
  var sea_lit = vec3f(0.10, 0.45, 0.48);
  var foam_tone = vec3f(0.90, 0.95, 0.93);
  var lace_scale = 9.0;
  if (variant > 0.5 && variant < 1.5) {
    sea_deep = vec3f(0.02, 0.16, 0.38);
    sea_lit = vec3f(0.12, 0.48, 0.66);
    foam_tone = vec3f(0.94, 0.97, 0.95);
    lace_scale = 13.0;
  } else if (variant >= 1.5) {
    sea_deep = vec3f(0.06, 0.10, 0.13);
    sea_lit = vec3f(0.16, 0.24, 0.27);
    foam_tone = vec3f(0.72, 0.78, 0.80);
    lace_scale = 7.0;
  }
  let swell = fbm(uv.x * 4.0 + seed, uv.y * 4.0 - seed * 0.3, 4.0) * 0.5 + 0.5;
  var col = mix(sea_deep, sea_lit, swell);
  let vor = voronoi(uv.x * lace_scale + sin(uv.y * 6.0 + seed) * 0.4, uv.y * lace_scale + seed);
  let lace = smoothstep(0.30, 0.05, abs(vor.x - 0.32));
  let patchy = smoothstep(0.35, 0.75, fbm(uv.x * 3.0 - seed, uv.y * 3.0 + seed, 3.0) * 0.5 + 0.5);
  col = mix(col, foam_tone, lace * patchy * 0.85);
  let bub = speckle(px, 3.0, seed + 2.0, 0.93);
  col = mix(col, foam_tone, bub * 0.5);
  let glint = line_near(sin(uv.x * 24.0 + seed) * sin(uv.y * 20.0 - seed), 0.10);
  col = col + vec3f(0.05, 0.09, 0.10) * glint * (1.0 - lace * patchy);
  return sat3(col);
}
