// @material lapis_lazuli
// @slug lapis-lazuli
// @name Lapis Lazuli
// @board neon_surface
// @variant-labels Temple Blue, Calcite Storm, Midnight Vein
// @kind surface
// @tags neon_surface, lapis, blue, pyrite
// @author fable-gems_precious
fn lapis_lazuli(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.10, 0.18, 0.55);
  var deep_t = vec3f(0.04, 0.08, 0.32);
  var calcite = vec3f(0.80, 0.83, 0.88);
  var pyr = vec3f(0.90, 0.76, 0.32);
  var calcite_amt = 0.25;
  var pyr_thresh = 0.990;
  if (variant > 0.5 && variant < 1.5) {
    calcite_amt = 0.55; body = vec3f(0.14, 0.24, 0.62); pyr_thresh = 0.994;
  } else if (variant >= 1.5) {
    body = vec3f(0.06, 0.10, 0.38); deep_t = vec3f(0.02, 0.04, 0.18);
    calcite_amt = 0.12; pyr_thresh = 0.984; pyr = vec3f(0.82, 0.66, 0.26);
  }
  let swirl = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 5.0) * 0.5 + 0.5;
  var col = mix(deep_t, body, swirl);
  let cal_field = fbm(uv.x * 4.5, uv.y * 4.5 + seed * 0.9, 4.0) * 0.5 + 0.5;
  let cal_m = smoothstep(0.68, 0.80, cal_field) * calcite_amt * 2.0;
  col = mix(col, calcite, sat(cal_m));
  let fleck_cell = floor(px / 5.0);
  let fleck = step(pyr_thresh, rand(fleck_cell + vec2f(seed * 0.017, seed * 0.005)));
  col = mix(col, pyr, fleck * 0.9);
  col += pyr * speckle(px, 2.0, seed + 4.0, 0.996) * 0.6;
  let grain = fbm(uv.x * 30.0, uv.y * 30.0 + seed, 3.0) * 0.5 + 0.5;
  col = mix(col * 0.90, col * 1.08, grain);
  return sat3(col);
}
