// @material pebble_mosaic
// @slug pebble-mosaic
// @name Pebble Mosaic
// @board wood_brick_stone
// @variant-labels River Swirl, Sun Court, Slate Spiral
// @kind surface
// @tags wood_brick_stone, pebble, swirl, garden
// @author fable-mosaic_tile
fn pebble_mosaic(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // swirl warp so the pebble courses read as laid spirals
  let c = uv - vec2f(0.5, 0.5);
  let r = length(c) + 0.0001;
  let ang = atan2(c.y, c.x) + r * 4.5 + seed * 0.03;
  let wuv = vec2f(cos(ang), sin(ang)) * r + vec2f(0.5, 0.5);
  let v = voronoi(wuv.x * 9.0 + seed * 0.4, wuv.y * 9.0);
  let idr = fract(v.y * 6.17 + seed * 0.013);
  var mortar = vec3f(0.36, 0.33, 0.29);
  var stoneA = vec3f(0.62, 0.58, 0.52);
  var stoneB = vec3f(0.78, 0.72, 0.62);
  var stoneC = vec3f(0.40, 0.42, 0.46);
  if (variant > 0.5 && variant < 1.5) {
    mortar = vec3f(0.60, 0.54, 0.44);
    stoneA = vec3f(0.80, 0.66, 0.46);
    stoneB = vec3f(0.88, 0.80, 0.62);
    stoneC = vec3f(0.64, 0.40, 0.28);
  } else if (variant >= 1.5) {
    mortar = vec3f(0.22, 0.22, 0.24);
    stoneA = vec3f(0.36, 0.38, 0.44);
    stoneB = vec3f(0.55, 0.57, 0.60);
    stoneC = vec3f(0.70, 0.68, 0.62);
  }
  var stone = stoneA;
  if (idr > 0.45) { stone = stoneB; }
  if (idr > 0.8) { stone = stoneC; }
  // pebble dome: bright center falling to dark rim
  let dome = 1.0 - smoothstep(0.0, 0.34, v.x);
  let body = 1.0 - smoothstep(0.24, 0.34, v.x);
  var col = mortar * (0.85 + 0.3 * (fbm(uv.x * 12.0 + seed, uv.y * 12.0, 3.0) * 0.5 + 0.5));
  col = mix(col, stone * (0.65 + 0.5 * dome), body);
  // wet gloss point on each pebble
  let glint = 1.0 - smoothstep(0.0, 0.09, v.x);
  col = col + vec3f(0.12, 0.12, 0.11) * glint * body * step(0.3, idr);
  // moss creeping into joints
  let moss = smoothstep(0.55, 0.9, fbm(uv.x * 5.0 - seed * 0.3, uv.y * 5.0, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.24, 0.34, 0.16), moss * (1.0 - body) * 0.55);
  col = col - vec3f(speckle(px, 1.6, seed, 0.94) * 0.08);
  return sat3(col);
}
