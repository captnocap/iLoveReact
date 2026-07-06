// @material pumice_pocked
// @slug pumice-pocked
// @name Pocked Pumice
// @board wood_brick_stone
// @variant-labels Pale Float, Tan Ash, Dark Scoria
// @kind surface
// @tags wood_brick_stone, pumice, volcanic, porous
// @author fable-geology
fn pumice_pocked(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.66, 0.65, 0.62);
  var hole = vec3f(0.22, 0.21, 0.20);
  var lite = vec3f(0.80, 0.79, 0.76);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.66, 0.58, 0.46);
    hole = vec3f(0.26, 0.20, 0.14);
    lite = vec3f(0.80, 0.72, 0.58);
  } else if (variant >= 1.5) {
    base = vec3f(0.30, 0.28, 0.28);
    hole = vec3f(0.06, 0.05, 0.05);
    lite = vec3f(0.44, 0.42, 0.42);
  }
  let body = fbm(uv.x * 8.0 + seed * 0.5, uv.y * 8.0 - seed * 0.2, 3.0);
  var col = mix(base, lite, smoothstep(-0.1, 0.4, body));
  let v1 = voronoi(uv.x * 16.0 + seed, uv.y * 16.0 - seed * 0.6);
  let g1 = step(0.42, rand(vec2f(v1.y, seed * 0.07)));
  col = mix(col, hole, smoothstep(0.26, 0.08, v1.x) * g1 * 0.9);
  let v2 = voronoi(uv.x * 38.0 - seed * 0.4, uv.y * 38.0 + seed * 0.9);
  let g2 = step(0.35, rand(vec2f(v2.y, seed * 0.05 + 3.0)));
  col = mix(col, hole, smoothstep(0.20, 0.05, v2.x) * g2 * 0.8);
  let rim = smoothstep(0.30, 0.26, v1.x) * (1.0 - smoothstep(0.26, 0.08, v1.x)) * g1;
  col = mix(col, lite * 1.1, rim * 0.5);
  col = col * (0.92 + fbm(uv.x * 50.0 + seed, uv.y * 50.0, 3.0) * 0.24);
  col = mix(col, lite, speckle(px, 2.0, seed + 5.0, 0.98) * 0.4);
  return sat3(col);
}
