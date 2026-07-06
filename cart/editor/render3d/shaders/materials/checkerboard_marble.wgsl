// @material checkerboard_marble
// @slug checkerboard-marble
// @name Checkerboard Marble
// @board wood_brick_stone
// @variant-labels Palace Classic, Serpentine Cream, Worn Foyer
// @kind surface
// @tags wood_brick_stone, checker, marble, floor
// @author fable-mosaic_tile
fn checkerboard_marble(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let sc = 4.0;
  let cell = floor(uv * sc);
  let lc = fract(uv * sc);
  let par = fract((cell.x + cell.y) * 0.5) * 2.0;
  // marble veining: warped ridged noise
  let warp = fbm(uv.x * 3.0 + seed * 0.21, uv.y * 3.0, 3.0);
  let vein1 = abs(snoise(uv.x * 5.0 + warp * 2.4 + seed * 0.1, uv.y * 5.0 - warp * 1.8));
  let vein2 = abs(snoise(uv.x * 11.0 - warp * 3.0, uv.y * 11.0 + seed * 0.07));
  let vn = (1.0 - smoothstep(0.0, 0.10, vein1)) * 0.8 + (1.0 - smoothstep(0.0, 0.07, vein2)) * 0.4;
  var darkStone = vec3f(0.09, 0.09, 0.11);
  var darkVein = vec3f(0.55, 0.55, 0.58);
  var liteStone = vec3f(0.88, 0.86, 0.82);
  var liteVein = vec3f(0.52, 0.50, 0.48);
  if (variant > 0.5 && variant < 1.5) {
    darkStone = vec3f(0.10, 0.24, 0.17);
    darkVein = vec3f(0.62, 0.72, 0.62);
    liteStone = vec3f(0.90, 0.86, 0.76);
    liteVein = vec3f(0.66, 0.58, 0.44);
  } else if (variant >= 1.5) {
    darkStone = vec3f(0.22, 0.20, 0.19);
    darkVein = vec3f(0.44, 0.42, 0.40);
    liteStone = vec3f(0.72, 0.69, 0.63);
    liteVein = vec3f(0.50, 0.47, 0.42);
  }
  let tone = rand(cell + vec2f(seed * 0.33, 2.1)) * 0.14;
  var col = mix(darkStone * (1.0 + tone), mix(darkStone, darkVein, sat(vn)), sat(vn));
  if (par > 0.5) {
    col = mix(liteStone * (1.0 - tone), liteVein, sat(vn) * 0.7);
  }
  // polished sheen sweeping diagonally
  let sheen = smoothstep(0.3, 0.9, sin((uv.x + uv.y) * 4.5 + seed * 0.5) * 0.5 + 0.5);
  col = col + vec3f(0.05, 0.05, 0.06) * sheen * (1.0 - 0.5 * step(1.5, variant));
  // grout seams
  let ge = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  col = mix(vec3f(0.35, 0.33, 0.30), col, smoothstep(0.004, 0.020, ge));
  let scuff = step(1.5, variant) * smoothstep(0.5, 0.9, fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.55, 0.52, 0.46), scuff * 0.3);
  col = col - vec3f(speckle(px, 1.6, seed, 0.95) * 0.06);
  return sat3(col);
}
