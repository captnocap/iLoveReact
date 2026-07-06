// @material travertine_bands
// @slug travertine-bands
// @name Banded Travertine
// @board wood_brick_stone
// @variant-labels Roman Beige, Silver Vein, Walnut Warm
// @kind surface
// @tags wood_brick_stone, travertine, stone, pitted
// @author fable-geology
fn travertine_bands(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.72, 0.62, 0.48);
  var hi = vec3f(0.88, 0.80, 0.66);
  var pit_c = vec3f(0.42, 0.34, 0.24);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.58, 0.58, 0.57);
    hi = vec3f(0.82, 0.82, 0.80);
    pit_c = vec3f(0.32, 0.32, 0.32);
  } else if (variant >= 1.5) {
    lo = vec3f(0.48, 0.36, 0.24);
    hi = vec3f(0.76, 0.62, 0.44);
    pit_c = vec3f(0.24, 0.16, 0.10);
  }
  let warp = fbm(uv.x * 3.5 + seed * 0.5, uv.y * 8.0, 3.0);
  let strat = uv.y * 14.0 + warp * 0.8 + seed * 0.19;
  let bt = rand(vec2f(floor(strat), floor(seed * 0.3)));
  var col = mix(lo, hi, 0.3 + bt * 0.7);
  col = mix(col, lo * 0.8, smoothstep(0.10, 0.0, fract(strat)) * 0.5);
  let pv = voronoi(uv.x * 24.0 + seed, uv.y * 60.0 - seed * 0.7);
  let pit_gate = step(0.68, rand(vec2f(pv.y, seed * 0.09)));
  let pit = smoothstep(0.22, 0.05, pv.x) * pit_gate;
  col = mix(col, pit_c, pit * 0.85);
  let pv2 = voronoi(uv.x * 55.0 - seed * 0.3, uv.y * 120.0 + seed);
  col = mix(col, pit_c, smoothstep(0.14, 0.03, pv2.x) * step(0.78, rand(vec2f(pv2.y, 2.2))) * 0.6);
  let grain = fbm(uv.x * 28.0 - seed, uv.y * 28.0, 3.0);
  col = col * (0.93 + grain * 0.22);
  col = mix(col, hi * 1.08, speckle(px, 2.0, seed + 6.0, 0.98) * 0.35);
  return sat3(col);
}
