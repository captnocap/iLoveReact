// @material gold_leaf
// @slug gold-leaf
// @name Gold Leaf
// @board neon_surface
// @variant-labels Fresh Gilding, Worn Bole, Verdigris Age
// @kind surface
// @tags neon_surface, gold, gilded, cracks
// @author fable-gems_precious
fn gold_leaf(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var gold_hi = vec3f(0.93, 0.75, 0.31);
  var gold_lo = vec3f(0.68, 0.49, 0.15);
  var bole = vec3f(0.32, 0.13, 0.09);
  var wear = 0.30;
  if (variant > 0.5 && variant < 1.5) {
    wear = 0.72; gold_hi = vec3f(0.82, 0.63, 0.26); bole = vec3f(0.18, 0.10, 0.07);
  } else if (variant >= 1.5) {
    gold_hi = vec3f(0.84, 0.77, 0.42); gold_lo = vec3f(0.53, 0.51, 0.29);
    bole = vec3f(0.21, 0.35, 0.28); wear = 0.52;
  }
  let sheets = 3.0;
  let cell = floor(uv * sheets);
  let sheet_id = rand(cell + vec2f(seed * 0.013, seed * 0.007));
  let lc = fract(uv * sheets);
  var col = mix(gold_lo, gold_hi, 0.35 + 0.65 * sheet_id);
  let wrin = fbm(uv.x * 30.0 + seed, uv.y * 30.0 + sheet_id * 9.0, 4.0) * 0.5 + 0.5;
  col = mix(col * 0.80, col * 1.22, wrin);
  let ex = min(lc.x, 1.0 - lc.x);
  let ey = min(lc.y, 1.0 - lc.y);
  let edge = min(ex, ey);
  col = mix(col * 0.55, col, smoothstep(0.0, 0.035, edge));
  col = mix(col, col * 1.28, line_near(edge - 0.06, 0.02) * 0.6);
  let cr = crack_field(uv, seed + 7.0, 5.0);
  col = mix(col, bole, cr * wear);
  col += vec3f(1.0, 0.95, 0.70) * speckle(px, 2.0, seed + 3.0, 0.995) * 0.5;
  return sat3(col);
}
