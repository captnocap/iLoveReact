// @material zellige_star
// @slug zellige-star
// @name Zellige Star
// @board wood_brick_stone
// @variant-labels Cobalt Court, Fes Green Gold, Night Palace
// @kind surface
// @tags wood_brick_stone, zellige, mosaic, star
// @author fable-mosaic_tile
fn zellige_star(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let sc = 4.0;
  let cell = floor(uv * sc);
  let lc = fract(uv * sc);
  let p = lc - vec2f(0.5, 0.5);
  let sq = max(abs(p.x), abs(p.y));
  let dm = (abs(p.x) + abs(p.y)) * 0.70710678;
  let star = min(sq, dm);
  let starMask = 1.0 - smoothstep(0.285, 0.315, star);
  let glz = rand(cell + vec2f(seed * 0.13, seed * 0.07));
  let flip = step(0.5, rand(cell + vec2f(3.1, seed * 0.4)));
  var ground = mix(vec3f(0.86, 0.82, 0.70), vec3f(0.93, 0.90, 0.80), glz);
  var ink = mix(vec3f(0.10, 0.28, 0.46), vec3f(0.17, 0.44, 0.62), glz);
  if (variant > 0.5 && variant < 1.5) {
    ground = mix(vec3f(0.90, 0.86, 0.74), vec3f(0.95, 0.92, 0.82), glz);
    ink = mix(vec3f(0.13, 0.38, 0.26), vec3f(0.72, 0.55, 0.18), flip);
  } else if (variant >= 1.5) {
    ground = mix(vec3f(0.19, 0.16, 0.15), vec3f(0.27, 0.22, 0.19), glz);
    ink = mix(vec3f(0.78, 0.60, 0.25), vec3f(0.56, 0.21, 0.17), flip);
  }
  var col = mix(ground, ink, starMask);
  let core = 1.0 - smoothstep(0.10, 0.13, star);
  col = mix(col, mix(ink * 0.55, ground, 0.35), core * starMask);
  let g = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  col = mix(vec3f(0.33, 0.30, 0.26), col, smoothstep(0.008, 0.035, g));
  let sheen = smoothstep(0.2, 0.8, snoise(uv.x * 6.0 + seed, uv.y * 6.0)) * 0.10;
  col = col + vec3f(sheen, sheen, sheen * 0.9);
  col = col - vec3f(speckle(px, 1.6, seed, 0.95) * 0.10);
  return sat3(col);
}
