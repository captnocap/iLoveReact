// @material parquet_floor
// @slug parquet-floor
// @name Parquet Floor
// @board wood_brick_stone
// @variant-labels Herringbone, Checker, Basket Weave
// @kind surface
// @tags wood_brick_stone, parquet, floor
// @author legacy
fn parquet_floor(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let tile = floor(uv * 6.0);
  let l = fract(uv * 6.0);
  let flip = step(0.5, rand(tile + vec2f(seed, seed)));
  var grain_uv = select(vec2f(l.x, l.y), vec2f(l.y, l.x), flip > 0.5);
  if (variant > 0.5 && variant < 1.5) { grain_uv = l; }
  if (variant >= 1.5) { grain_uv = vec2f(fract((l.x + l.y) * 0.5), l.y); }
  var col = wood(grain_uv, px, 0.0, seed + tile.x + tile.y);
  let seam = max(1.0 - smoothstep(0.015, 0.035, min(l.x, 1.0 - l.x)), 1.0 - smoothstep(0.015, 0.035, min(l.y, 1.0 - l.y)));
  col = mix(col, vec3f(0.10, 0.06, 0.03), seam * 0.70);
  return sat3(col);
}
