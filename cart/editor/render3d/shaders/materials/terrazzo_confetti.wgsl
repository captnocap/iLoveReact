// @material terrazzo_confetti
// @slug terrazzo-confetti
// @name Terrazzo Confetti
// @board wood_brick_stone
// @variant-labels Milkbar Pop, Umber Field, Night Confetti
// @kind surface
// @tags wood_brick_stone, terrazzo, chips, floor
// @author fable-mosaic_tile
fn terrazzo_confetti(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ground = vec3f(0.88, 0.85, 0.80);
  if (variant > 0.5 && variant < 1.5) { ground = vec3f(0.72, 0.62, 0.50); }
  if (variant >= 1.5) { ground = vec3f(0.16, 0.16, 0.19); }
  // cement ground with mottling
  let mott = fbm(uv.x * 6.0 + seed * 0.27, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  var col = ground * (0.90 + 0.18 * mott);
  // big chips
  let v1 = voronoi(uv.x * 6.5 + seed * 0.51, uv.y * 6.5);
  let idr = fract(v1.y * 7.13 + seed * 0.017);
  let chipSize = 0.20 + 0.22 * fract(v1.y * 3.71);
  var chip = vec3f(0.83, 0.32, 0.30);
  if (idr > 0.2) { chip = vec3f(0.94, 0.72, 0.24); }
  if (idr > 0.4) { chip = vec3f(0.26, 0.55, 0.50); }
  if (idr > 0.6) { chip = vec3f(0.23, 0.28, 0.52); }
  if (idr > 0.8) { chip = vec3f(0.93, 0.90, 0.86); }
  if (variant > 0.5 && variant < 1.5) {
    if (idr > 0.5) { chip = mix(vec3f(0.36, 0.22, 0.16), vec3f(0.90, 0.84, 0.72), fract(idr * 5.0)); }
  }
  let big = 1.0 - smoothstep(chipSize - 0.05, chipSize + 0.02, v1.x);
  col = mix(col, chip * (0.85 + 0.3 * fract(v1.y * 11.7)), big * 0.95);
  // small chips layer
  let v2 = voronoi(uv.x * 16.0 - seed * 0.34, uv.y * 16.0 + 4.0);
  let idr2 = fract(v2.y * 5.31);
  var chip2 = vec3f(0.30, 0.29, 0.28);
  if (idr2 > 0.5) { chip2 = vec3f(0.86, 0.83, 0.78); }
  if (variant >= 1.5 && idr2 > 0.7) { chip2 = vec3f(0.90, 0.55, 0.65); }
  let small2 = 1.0 - smoothstep(0.10, 0.16, v2.x);
  col = mix(col, chip2, small2 * 0.8 * step(0.25, fract(v2.y * 2.9)));
  // polish sheen + grain
  let sheen = smoothstep(0.4, 0.95, snoise(uv.x * 3.0 + seed * 0.2, uv.y * 3.0)) * 0.07;
  col = col + vec3f(sheen, sheen, sheen);
  col = col - vec3f(speckle(px, 1.5, seed, 0.93) * 0.08);
  return sat3(col);
}
