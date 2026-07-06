// @material chalk_cliff
// @slug chalk-cliff
// @name Chalk Cliff
// @board wood_brick_stone
// @variant-labels Dover White, Weathered Grey, Flint Rich
// @kind surface
// @tags wood_brick_stone, chalk, cliff, flint
// @author fable-geology
fn chalk_cliff(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.90, 0.89, 0.85);
  var shade = vec3f(0.72, 0.71, 0.68);
  var flint = vec3f(0.16, 0.16, 0.18);
  var band_n = 3.0;
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.78, 0.77, 0.73);
    shade = vec3f(0.58, 0.58, 0.56);
    flint = vec3f(0.20, 0.19, 0.20);
  } else if (variant >= 1.5) {
    base = vec3f(0.88, 0.86, 0.81);
    shade = vec3f(0.68, 0.66, 0.62);
    flint = vec3f(0.12, 0.12, 0.15);
    band_n = 5.0;
  }
  let powder = fbm(uv.x * 12.0 + seed * 0.7, uv.y * 12.0 - seed * 0.3, 4.0);
  var col = mix(shade, base, 0.6 + powder * 0.8);
  let scrape = fbm(uv.x * 3.0 + seed, uv.y * 40.0, 3.0);
  col = col * (0.94 + scrape * 0.14);
  let brow = uv.y * band_n + fbm(uv.x * 2.0 + seed * 0.4, uv.y, 3.0) * 0.4 + seed * 0.17;
  let in_band = smoothstep(0.14, 0.06, abs(fract(brow) - 0.5));
  let nod = voronoi(uv.x * 20.0 + seed, uv.y * 26.0 - seed * 0.8);
  let nod_gate = step(0.45, rand(vec2f(nod.y, seed * 0.08)));
  let nodule = smoothstep(0.24, 0.10, nod.x) * nod_gate * in_band;
  col = mix(col, flint, nodule * 0.95);
  col = mix(col, base * 1.05, smoothstep(0.28, 0.22, nod.x) * (1.0 - smoothstep(0.24, 0.10, nod.x)) * nod_gate * in_band * 0.8);
  col = mix(col, shade * 0.85, sat(vertical_drips(uv, seed + 6.0, 0.7)) * 0.25);
  col = mix(col, shade, speckle(px, 2.0, seed + 3.0, 0.975) * 0.4);
  return sat3(col);
}
