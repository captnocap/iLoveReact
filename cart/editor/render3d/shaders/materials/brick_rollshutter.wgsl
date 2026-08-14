// @material brick_rollshutter
// @slug brick-rollshutter
// @name Roll Shutter
// @board facades
// @variant-labels Plain, Tagged, Graffitied
// @kind composition
// @tags facades, roll, shutter
// @author legacy
fn brick_rollshutter(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Closed storefront: a corrugated roll-down shutter in the ground-floor bay,
  // side rails, a lintel above. variant 0 plain, 1 tagged, 2 heavily graffitied.
  var col = brick_wall(uv, px, vec3f(0.40, 0.13, 0.085), vec3f(0.74, 0.29, 0.17), vec3f(0.55, 0.53, 0.48), seed);
  let sh = rect_mask(uv, 0.10, 0.90, 0.0, 0.70, 0.006);
  let rib = 0.5 + 0.5 * sin(uv.y * 90.0);
  var shutter = mix(vec3f(0.30, 0.31, 0.33), vec3f(0.50, 0.51, 0.53), rib);
  if (variant >= 0.5) {
    let tag1 = blotch(uv, vec2f(0.40, 0.40), 0.13, vec2f(1.2, 1.6), seed);
    let tag2 = blotch(uv, vec2f(0.62, 0.34), 0.10, vec2f(1.4, 1.0), seed + 5.0);
    shutter = mix(shutter, vec3f(0.90, 0.18, 0.44), tag1 * 0.7);
    shutter = mix(shutter, vec3f(0.20, 0.82, 0.55), tag2 * 0.6);
  }
  if (variant >= 1.5) {
    let tag3 = blotch(uv, vec2f(0.30, 0.30), 0.11, vec2f(1.0, 1.3), seed + 9.0);
    let scrawl = line_near(snoise(uv.x * 9.0 + seed, uv.y * 9.0 - seed), 0.020);
    shutter = mix(shutter, vec3f(0.96, 0.82, 0.16), tag3 * 0.7);
    shutter = mix(shutter, vec3f(0.05, 0.05, 0.06), scrawl * 0.5);
  }
  let rail = max(1.0 - smoothstep(0.0, 0.018, abs(uv.x - 0.10)), 1.0 - smoothstep(0.0, 0.018, abs(uv.x - 0.90)));
  shutter = mix(shutter, vec3f(0.16, 0.16, 0.18), sat(rail));
  col = mix(col, shutter, sh);
  let lintel = rect_mask(uv, 0.08, 0.92, 0.70, 0.76, 0.006);
  col = mix(col, vec3f(0.50, 0.48, 0.44), lintel);
  return sat3(col);
}
