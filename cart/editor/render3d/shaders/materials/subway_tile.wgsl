// @material subway_tile
// @slug subway-tile
// @name Subway Tile
// @board wood_brick_stone
// @variant-labels Diner White, Pharmacy Green, Midnight Gloss
// @kind surface
// @tags wood_brick_stone, subway, tile, glaze
// @author fable-mosaic_tile
fn subway_tile(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rowsN = 10.0;
  let ty = uv.y * rowsN;
  let row = floor(ty);
  let tx = uv.x * (rowsN * 0.5) + fract(row * 0.5);
  let cellId = vec2f(floor(tx), row);
  let lc = vec2f(fract(tx), fract(ty));
  let tone = rand(cellId + vec2f(seed * 0.21, seed * 0.09));
  var face = mix(vec3f(0.88, 0.88, 0.85), vec3f(0.97, 0.96, 0.92), tone);
  var groutCol = vec3f(0.62, 0.60, 0.56);
  if (variant > 0.5 && variant < 1.5) {
    face = mix(vec3f(0.13, 0.36, 0.28), vec3f(0.22, 0.50, 0.38), tone);
    groutCol = vec3f(0.78, 0.76, 0.70);
  } else if (variant >= 1.5) {
    face = mix(vec3f(0.08, 0.09, 0.13), vec3f(0.15, 0.17, 0.23), tone);
    groutCol = vec3f(0.42, 0.41, 0.40);
  }
  // beveled edge shading
  let ex = min(lc.x, 1.0 - lc.x);
  let ey = min(lc.y, 1.0 - lc.y);
  let edge = min(ex * 0.5, ey);
  var col = face * (0.78 + 0.22 * smoothstep(0.02, 0.14, edge));
  // gloss band across the upper third of each tile
  let gloss = smoothstep(0.16, 0.30, lc.y) * (1.0 - smoothstep(0.34, 0.50, lc.y));
  col = col + vec3f(0.10, 0.10, 0.09) * gloss * (0.5 + 0.5 * tone);
  // grout
  let gm = 1.0 - smoothstep(0.015, 0.045, min(ex * 0.5, ey));
  col = mix(col, groutCol * (0.8 + 0.3 * rand(cellId + vec2f(1.7, seed))), gm);
  // grime settling in the grout and lower rows
  let grime = fbm(uv.x * 4.0 + seed * 0.4, uv.y * 4.0, 3.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.20, 0.19, 0.16), gm * grime * 0.35);
  col = col - vec3f(speckle(px, 1.5, seed, 0.955) * 0.07);
  return sat3(col);
}
