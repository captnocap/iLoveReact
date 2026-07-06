// @material encaustic_tile
// @slug encaustic-tile
// @name Encaustic Tile
// @board wood_brick_stone
// @variant-labels Terracotta Cream, Parisian Grey, Sun Faded
// @kind surface
// @tags wood_brick_stone, encaustic, motif, tile
// @author fable-mosaic_tile
fn encaustic_tile(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let sc = 4.0;
  let cell = floor(uv * sc);
  let lc = fract(uv * sc);
  // alternating corner so quarter-arcs assemble into full circles
  let cx = fract(cell.x * 0.5) * 2.0;
  let cy = fract(cell.y * 0.5) * 2.0;
  let corner = vec2f(cx, cy);
  let d = length(lc - corner);
  var inkA = vec3f(0.63, 0.33, 0.22);
  var inkB = vec3f(0.90, 0.86, 0.76);
  var inkC = vec3f(0.25, 0.34, 0.38);
  if (variant > 0.5 && variant < 1.5) {
    inkA = vec3f(0.34, 0.36, 0.40);
    inkB = vec3f(0.88, 0.87, 0.84);
    inkC = vec3f(0.62, 0.55, 0.36);
  } else if (variant >= 1.5) {
    inkA = vec3f(0.72, 0.52, 0.40);
    inkB = vec3f(0.87, 0.82, 0.72);
    inkC = vec3f(0.52, 0.56, 0.50);
  }
  var col = inkB;
  // big quarter-disc petal
  col = mix(inkA, col, smoothstep(0.62, 0.66, d));
  // ring accent
  let ring = 1.0 - smoothstep(0.015, 0.05, abs(d - 0.80));
  col = mix(col, inkC, ring);
  // small diamond at the tile's free corner
  let fc = vec2f(1.0 - corner.x, 1.0 - corner.y);
  let manh = abs(lc.x - fc.x) + abs(lc.y - fc.y);
  col = mix(col, inkC, 1.0 - smoothstep(0.14, 0.18, manh));
  // grout
  let ge = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  col = mix(vec3f(0.40, 0.37, 0.33), col, smoothstep(0.008, 0.03, ge));
  // cement fade: pigment thins in worn patches
  let wear = fbm(uv.x * 3.5 + seed * 0.23, uv.y * 3.5, 3.0) * 0.5 + 0.5;
  let fadeAmt = 0.30 + 0.35 * step(1.5, variant);
  col = mix(col, vec3f(0.81, 0.78, 0.72), smoothstep(0.45, 0.85, wear) * fadeAmt);
  col = col - vec3f(crack_field(uv, seed, 9.0) * 0.10 + speckle(px, 1.8, seed, 0.94) * 0.08);
  return sat3(col);
}
