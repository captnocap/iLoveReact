// @material sidewalk_utility
// @slug sidewalk-utility
// @name Utility Sidewalk
// @board street_ground
// @variant-labels Water Covers, Telecom Pullbox, Gas Plates
// @kind surface
// @tags street_ground, utility, sidewalk
// @author legacy
fn sidewalk_utility(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = sidewalk_grid(uv, px, 0.0, seed);
  var metal = vec3f(0.24, 0.24, 0.23);
  if (variant > 0.5 && variant < 1.5) { metal = vec3f(0.18, 0.21, 0.23); }
  else if (variant >= 1.5) { metal = vec3f(0.38, 0.28, 0.18); }
  let box = rect_mask(uv, 0.22, 0.78, 0.28, 0.62, 0.006);
  let lid = rect_mask(uv, 0.26, 0.74, 0.32, 0.58, 0.006);
  let round = 1.0 - smoothstep(0.17, 0.19, length((uv - vec2f(0.50, 0.45)) * vec2f(1.0, 1.0)));
  let plate = select(max(box, lid), round, variant >= 1.5);
  var pcol = mix(metal * 0.7, metal * 1.35, fbm(uv.x * 20.0, uv.y * 20.0 + seed, 4.0) * 0.5 + 0.5);
  let ribs = line_near(sin((uv.x + uv.y * 0.1) * 80.0), 0.08) * plate;
  pcol = mix(pcol, metal * 0.45, ribs * 0.45);
  let bolts = speckle(px, 10.0, seed, 0.94) * plate;
  pcol = mix(pcol, vec3f(0.08, 0.08, 0.075), bolts * 0.6);
  col = mix(col, pcol, plate);
  return sat3(col);
}
