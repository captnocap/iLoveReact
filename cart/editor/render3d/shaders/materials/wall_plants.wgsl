// @material wall_plants
// @slug wall-plants
// @name Wall Plants
// @board wall_props
// @variant-labels Window Box, Hanging Vines, Ivy Climb
// @kind surface
// @tags wall_props, wall, plants
// @author legacy
fn wall_plants(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Greenery on the apartment face. variant 0 window boxes, 1 hanging vines,
  // 2 climbing ivy.
  var col = brick_facade(uv, px, 0.0, seed);
  if (variant < 0.5) {
    let box = max(rect_mask(uv, 0.30, 0.70, 0.280, 0.345, 0.005), rect_mask(uv, 0.30, 0.70, 0.780, 0.845, 0.005));
    let canopy = max(rect_mask(uv, 0.28, 0.72, 0.345, 0.47, 0.02), rect_mask(uv, 0.28, 0.72, 0.845, 0.97, 0.02));
    let drape = max(rect_mask(uv, 0.30, 0.70, 0.24, 0.345, 0.02), rect_mask(uv, 0.30, 0.70, 0.74, 0.845, 0.02));
    let fol = leaf_cover(uv, 0.45, seed) * max(canopy, drape);
    col = mix(col, vec3f(0.26, 0.18, 0.11), box);
    col = mix(col, leaf_color(uv, seed), fol);
    let flower = speckle(px, 6.0, seed, 0.93) * fol;
    col = mix(col, vec3f(0.95, 0.55, 0.65), flower * 0.8);
  } else if (variant < 1.5) {
    let vine = leaf_cover(vec2f(uv.x, uv.y * 0.6), 0.50 - smoothstep(0.30, 1.0, uv.y) * 0.18, seed) * smoothstep(0.30, 1.0, uv.y);
    col = mix(col, leaf_color(uv, seed + 3.0), vine);
  } else {
    let dense = smoothstep(1.4, 0.2, uv.x + uv.y);
    let ivy = leaf_cover(uv, 0.52 - dense * 0.25, seed) * dense;
    col = mix(col, leaf_color(uv, seed + 7.0), ivy);
  }
  return sat3(col);
}
