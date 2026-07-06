// @material penrose_tiling
// @slug penrose-tiling
// @name Penrose Tiling
// @board wood_brick_stone
// @variant-labels Desert Rhombs, Teal Study, Gilded Slate
// @kind surface
// @tags wood_brick_stone, penrose, rhombus, geometric
// @author fable-mosaic_tile
fn penrose_tiling(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let sc = 5.0;
  var lineMask = 0.0;
  var idsum = 0.0;
  for (var i = 0; i < 5; i = i + 1) {
    let ang = f32(i) * 1.2566371;
    let dir = vec2f(cos(ang), sin(ang));
    let t = dot(uv, dir) * sc + rand(vec2f(f32(i) * 2.3, seed * 0.11)) * 0.9;
    let ft = fract(t);
    let d = min(ft, 1.0 - ft);
    lineMask = max(lineMask, 1.0 - smoothstep(0.020, 0.055, d));
    idsum = idsum + floor(t);
  }
  let par = fract(idsum * 0.5) * 2.0;
  let tri = floor(fract(idsum * 0.33333) * 3.0);
  var tileA = vec3f(0.85, 0.74, 0.56);
  var tileB = vec3f(0.66, 0.38, 0.26);
  var tileC = vec3f(0.90, 0.85, 0.74);
  var inkLine = vec3f(0.24, 0.17, 0.13);
  if (variant > 0.5 && variant < 1.5) {
    tileA = vec3f(0.20, 0.44, 0.46);
    tileB = vec3f(0.12, 0.24, 0.32);
    tileC = vec3f(0.82, 0.86, 0.80);
    inkLine = vec3f(0.06, 0.10, 0.12);
  } else if (variant >= 1.5) {
    tileA = vec3f(0.36, 0.35, 0.37);
    tileB = vec3f(0.24, 0.23, 0.26);
    tileC = vec3f(0.48, 0.45, 0.44);
    inkLine = vec3f(0.82, 0.66, 0.30);
  }
  var col = mix(tileA, tileB, par);
  col = mix(col, tileC, step(1.5, tri) * 0.85);
  let patina = fbm(uv.x * 7.0 + seed * 0.2, uv.y * 7.0, 3.0) * 0.5 + 0.5;
  col = col * (0.86 + 0.28 * patina);
  col = mix(col, inkLine, lineMask * 0.9);
  col = col - vec3f(speckle(px, 1.7, seed, 0.94) * 0.09);
  return sat3(col);
}
