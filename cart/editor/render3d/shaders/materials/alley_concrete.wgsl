// @material alley_concrete
// @slug alley-concrete
// @name Alley Concrete
// @board street_ground
// @variant-labels Oil Spots, Trash Stains, Patchwork
// @kind surface
// @tags street_ground, alley, concrete
// @author legacy
fn alley_concrete(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = concrete(uv, px, 2.0, seed) * 0.82;
  let oil = blotch(uv, vec2f(0.32, 0.42), 0.18, vec2f(1.5, 0.8), seed) + blotch(uv, vec2f(0.70, 0.28), 0.12, vec2f(0.8, 1.4), seed + 5.0);
  let trash = speckle(px, 5.0, seed + 8.0, 0.93);
  let repair_area = rect_mask(uv, 0.08, 0.46, 0.62, 0.90, 0.010) * step(1.5, variant);
  col = mix(col, vec3f(0.035, 0.032, 0.028), sat(oil) * (0.35 + step(0.5, variant) * 0.20));
  col = mix(col, vec3f(0.40, 0.22, 0.10), vertical_drips(uv, seed, 1.0) * step(0.5, variant) * 0.50);
  col = mix(col, vec3f(0.70, 0.62, 0.44), trash * 0.30);
  col = mix(col, concrete(uv * vec2f(1.2, 1.0), px, 1.0, seed + 11.0), repair_area);
  return sat3(col);
}
