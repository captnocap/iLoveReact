// @material granite_rough
// @slug granite-rough
// @name Rough Granite
// @board wood_brick_stone
// @variant-labels Quarry Split, Weathered Grey, Lichen Crown
// @kind surface
// @tags wood_brick_stone, granite, stone, rough
// @author fable-geology
fn granite_rough(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.48, 0.45, 0.42);
  var crystal = vec3f(0.72, 0.68, 0.62);
  var shadow = vec3f(0.16, 0.15, 0.15);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.42, 0.42, 0.43);
    crystal = vec3f(0.63, 0.64, 0.66);
    shadow = vec3f(0.12, 0.12, 0.14);
  } else if (variant >= 1.5) {
    base = vec3f(0.40, 0.42, 0.36);
    crystal = vec3f(0.66, 0.66, 0.58);
    shadow = vec3f(0.13, 0.14, 0.11);
  }
  let vc = voronoi(uv.x * 9.0 + seed * 0.4, uv.y * 9.0 + seed * 0.9);
  let vc2 = voronoi(uv.x * 23.0 - seed * 0.6, uv.y * 23.0 + seed * 0.2);
  let tone = rand(vec2f(vc.y, 4.2)) * 0.6 + rand(vec2f(vc2.y, 8.8)) * 0.4;
  var col = mix(base, crystal, smoothstep(0.35, 0.75, tone));
  col = mix(col, shadow, smoothstep(0.30, 0.05, vc.x) * 0.35);
  let relief = fbm(uv.x * 14.0 + seed, uv.y * 14.0, 4.0);
  col = col * (0.82 + relief * 0.55);
  let fissure = crack_field(uv, seed + 2.0, 3.0);
  col = mix(col, shadow, fissure * 0.7);
  col = mix(col, crystal * 1.15, speckle(px, 3.0, seed + 6.0, 0.965) * 0.6);
  if (variant >= 1.5) {
    let lichen = blotch(uv, vec2f(0.3, 0.35), 0.16, vec2f(1.2, 0.9), seed + 3.0) + blotch(uv, vec2f(0.72, 0.66), 0.12, vec2f(0.9, 1.1), seed + 7.0);
    col = mix(col, vec3f(0.58, 0.60, 0.30), sat(lichen) * 0.5);
  }
  return sat3(col);
}
