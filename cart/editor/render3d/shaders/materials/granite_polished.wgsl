// @material granite_polished
// @slug granite-polished
// @name Polished Granite
// @board wood_brick_stone
// @variant-labels Salt Pepper, Rose Baltic, Black Galaxy
// @kind surface
// @tags wood_brick_stone, granite, stone, polished
// @author fable-geology
fn granite_polished(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.55, 0.53, 0.51);
  var fleck_hi = vec3f(0.84, 0.82, 0.79);
  var fleck_lo = vec3f(0.12, 0.11, 0.13);
  var accent = vec3f(0.58, 0.40, 0.36);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.64, 0.45, 0.40);
    fleck_hi = vec3f(0.90, 0.76, 0.68);
    fleck_lo = vec3f(0.18, 0.13, 0.13);
    accent = vec3f(0.32, 0.32, 0.38);
  } else if (variant >= 1.5) {
    base = vec3f(0.09, 0.09, 0.11);
    fleck_hi = vec3f(0.50, 0.52, 0.58);
    fleck_lo = vec3f(0.03, 0.03, 0.05);
    accent = vec3f(0.76, 0.62, 0.34);
  }
  let vc = voronoi(uv.x * 19.0 + seed * 0.71, uv.y * 19.0 + seed * 1.33);
  let tone = rand(vec2f(vc.y, floor(seed) * 0.13));
  var col = mix(base, fleck_hi, step(0.60, tone) * 0.85);
  col = mix(col, fleck_lo, step(0.78, fract(tone * 7.31)) * 0.9);
  col = mix(col, accent, step(0.90, fract(tone * 3.77)) * 0.8);
  let grain = fbm(uv.x * 42.0 + seed, uv.y * 42.0 - seed, 3.0);
  col = col * (0.92 + grain * 0.28);
  let sheen = pow(sat(1.0 - abs(uv.x + uv.y - 0.8 - fract(seed * 0.017) * 0.5) * 2.1), 3.0);
  col = col + vec3f(0.11, 0.11, 0.13) * sheen;
  col = col + vec3f(0.92, 0.92, 0.95) * speckle(px, 2.0, seed + 4.0, 0.986) * 0.75;
  return sat3(col);
}
