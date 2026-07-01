// @material storm_drain
// @slug storm-drain
// @name Storm Drain
// @board street_ground
// @variant-labels Curb Grate, Round Drain, Trench Drain
// @kind surface
// @tags street_ground, storm, drain
// @author legacy
fn storm_drain(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = sidewalk_grid(uv, px, 0.0, seed);
  let grate_rect = rect_mask(uv, 0.18, 0.82, 0.18, 0.70, 0.008);
  let round_grate = 1.0 - smoothstep(0.22, 0.25, length(uv - vec2f(0.5, 0.45)));
  let trench = rect_mask(uv, 0.10, 0.90, 0.38, 0.56, 0.006);
  let grate = select(grate_rect, round_grate, variant > 0.5 && variant < 1.5);
  let grate2 = select(grate, trench, variant >= 1.5);
  var metal = mix(vec3f(0.12, 0.12, 0.12), vec3f(0.36, 0.34, 0.30), fbm(uv.x * 18.0, uv.y * 18.0 + seed, 4.0) * 0.5 + 0.5);
  let bars = max(line_near(sin(uv.x * 80.0), 0.08), line_near(sin(uv.y * 55.0), 0.06)) * grate2;
  metal = mix(vec3f(0.02, 0.022, 0.020), metal, bars);
  col = mix(col, metal, grate2);
  col = mix(col, vec3f(0.08, 0.09, 0.07), vertical_drips(uv, seed, 1.0) * 0.28);
  return sat3(col);
}
