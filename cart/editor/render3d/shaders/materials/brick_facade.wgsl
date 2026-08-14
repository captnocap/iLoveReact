// @material brick_facade
// @slug brick-apartment
// @name Brick Apartment
// @board facades
// @variant-labels Red Brick, Buff Brick, Sooted Grey
// @kind composition
// @tags facades, brick, apartment
// @author legacy
fn brick_facade(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Apartment brick wall + a 2x2 grid of painted windows. variant 0 red brick,
  // 1 buff/sandstone brick, 2 sooted grey-brown brick.
  var lo = vec3f(0.42, 0.13, 0.085);
  var hi = vec3f(0.78, 0.30, 0.17);
  var mortar_c = vec3f(0.56, 0.54, 0.49);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.52, 0.43, 0.33);
    hi = vec3f(0.84, 0.72, 0.56);
    mortar_c = vec3f(0.62, 0.60, 0.55);
  } else if (variant >= 1.5) {
    lo = vec3f(0.30, 0.20, 0.18);
    hi = vec3f(0.52, 0.40, 0.36);
    mortar_c = vec3f(0.46, 0.44, 0.42);
  }
  var col = brick_wall(uv, px, lo, hi, mortar_c, seed);
  let g = uv * vec2f(2.0, 2.0);
  let cell = floor(g);
  let lc = fract(g);
  let lit = step(0.5, rand(cell + vec2f(seed * 0.7 + 3.0, seed * 3.1 + 1.0)));
  let w = paint_window(lc, lit, seed);
  col = mix(col, w.rgb, w.a);
  return sat3(col);
}
