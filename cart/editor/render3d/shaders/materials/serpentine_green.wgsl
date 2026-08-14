// @material serpentine_green
// @slug serpentine-green
// @name Green Serpentine
// @board wood_brick_stone
// @variant-labels Deep Forest, Lizard Mottle, Verd Antique
// @kind surface
// @tags wood_brick_stone, serpentine, green, veined
// @author fable-geology
fn serpentine_green(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.10, 0.28, 0.18);
  var patchTone = vec3f(0.18, 0.42, 0.26);
  var vein = vec3f(0.66, 0.76, 0.62);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.16, 0.32, 0.16);
    patchTone = vec3f(0.34, 0.52, 0.24);
    vein = vec3f(0.58, 0.66, 0.44);
  } else if (variant >= 1.5) {
    base = vec3f(0.06, 0.14, 0.11);
    patchTone = vec3f(0.12, 0.26, 0.20);
    vein = vec3f(0.82, 0.86, 0.80);
  }
  let mot = fbm(uv.x * 5.0 + seed * 0.7, uv.y * 5.0 - seed * 0.4, 3.0);
  var col = mix(base, patchTone, smoothstep(-0.25, 0.35, mot));
  if (variant > 0.5 && variant < 1.5) {
    let vc = voronoi(uv.x * 12.0 + seed, uv.y * 12.0 - seed * 0.6);
    col = mix(col, patchTone * (0.7 + rand(vec2f(vc.y, 3.3)) * 0.6), smoothstep(0.30, 0.12, vc.x) * 0.55);
  }
  let web1 = crack_field(uv, seed + 2.0, 2.5);
  let web2 = crack_field(uv + vec2f(0.31, 0.17), seed + 9.0, 5.0);
  col = mix(col, vein, web1 * 0.7);
  col = mix(col, vein * 0.8, web2 * 0.45);
  let grain = fbm(uv.x * 26.0 - seed, uv.y * 26.0, 3.0);
  col = col * (0.93 + grain * 0.2);
  let waxy = pow(sat(1.0 - abs(uv.x + uv.y * 0.6 - 0.8 - fract(seed * 0.04) * 0.3) * 1.9), 3.0);
  col = col + vec3f(0.08, 0.11, 0.08) * waxy;
  col = col + vec3f(0.80, 0.88, 0.78) * speckle(px, 2.0, seed + 5.0, 0.99) * 0.5;
  return sat3(col);
}
