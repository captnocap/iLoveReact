// @material hex_tile
// @slug hex-tile
// @name Hex Tile
// @board wood_brick_stone
// @variant-labels White Penny, Forest Mix, Charcoal Field
// @kind surface
// @tags wood_brick_stone, hex, tile, grout
// @author fable-mosaic_tile
fn hex_tile(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sc = 5.0;
  if (variant >= 1.5) { sc = 8.0; }
  let p = uv * sc;
  let s = vec2f(1.0, 1.7320508);
  let ca = (fract(p / s) - vec2f(0.5, 0.5)) * s;
  let cb = (fract((p - s * 0.5) / s) - vec2f(0.5, 0.5)) * s;
  var g = ca;
  if (dot(cb, cb) < dot(ca, ca)) { g = cb; }
  let id = p - g;
  let hd = max(abs(g.x) * 0.8660254 + abs(g.y) * 0.5, abs(g.y));
  let tone = rand(id + vec2f(seed * 0.29, seed * 0.13));
  let pick = rand(id + vec2f(7.7, seed * 0.41));
  var face = mix(vec3f(0.88, 0.87, 0.83), vec3f(0.96, 0.94, 0.90), tone);
  var groutCol = vec3f(0.16, 0.15, 0.14);
  if (variant > 0.5 && variant < 1.5) {
    face = mix(vec3f(0.16, 0.36, 0.28), vec3f(0.30, 0.52, 0.38), tone);
    if (pick > 0.72) { face = mix(vec3f(0.86, 0.83, 0.72), vec3f(0.93, 0.90, 0.80), tone); }
    groutCol = vec3f(0.10, 0.11, 0.10);
  } else if (variant >= 1.5) {
    face = mix(vec3f(0.24, 0.24, 0.26), vec3f(0.36, 0.35, 0.38), tone);
    if (pick > 0.82) { face = vec3f(0.80, 0.77, 0.72); }
    groutCol = vec3f(0.58, 0.56, 0.52);
  }
  let bevel = smoothstep(0.30, 0.44, hd) * 0.5;
  var col = face * (1.0 - bevel * 0.35);
  let topLite = smoothstep(0.0, -0.35, g.y) * (1.0 - smoothstep(0.28, 0.42, hd));
  col = col + vec3f(0.07, 0.07, 0.06) * topLite;
  col = mix(col, groutCol, smoothstep(0.415, 0.465, hd));
  let grime = fbm(uv.x * 5.0 + seed * 0.3, uv.y * 5.0, 3.0) * 0.5 + 0.5;
  col = col * (0.88 + 0.22 * grime);
  col = col - vec3f(speckle(px, 1.5, seed, 0.95) * 0.08);
  return sat3(col);
}
