// @material orange_peel
// @slug orange-peel
// @name Orange Peel
// @board props
// @variant-labels Navel Orange, Lime Zest, Meyer Lemon
// @kind surface
// @tags props, orange, citrus, fruit
// @author fable-food
fn orange_peel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var skin = vec3f(0.96, 0.55, 0.10);
  var skinLo = vec3f(0.80, 0.38, 0.05);
  var pore = vec3f(0.62, 0.28, 0.03);
  var blush = vec3f(0.92, 0.40, 0.14);
  if (variant > 0.5 && variant < 1.5) {
    skin = vec3f(0.42, 0.68, 0.16);
    skinLo = vec3f(0.28, 0.50, 0.10);
    pore = vec3f(0.18, 0.36, 0.06);
    blush = vec3f(0.62, 0.76, 0.22);
  } else if (variant >= 1.5) {
    skin = vec3f(0.97, 0.85, 0.26);
    skinLo = vec3f(0.86, 0.68, 0.14);
    pore = vec3f(0.68, 0.52, 0.08);
    blush = vec3f(0.95, 0.72, 0.30);
  }
  let vv = voronoi(uv.x * 26.0 + seed * 0.53, uv.y * 26.0 + seed * 0.29);
  let dimple = smoothstep(0.05, 0.35, vv.x);
  var col = mix(pore, skin, dimple);
  let roll = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 3.0) * 0.5 + 0.5;
  col = mix(col, skinLo, smoothstep(0.6, 0.9, roll) * 0.45);
  col = mix(col, blush, smoothstep(0.35, 0.1, roll) * 0.5);
  let microPore = speckle(px, 2.0, seed + 3.0, 0.90);
  col = mix(col, pore, microPore * 0.35);
  let waxShine = smoothstep(0.55, 0.85, dimple) * (smoothstep(0.7, 0.95, snoise(uv.x * 6.0 + seed, uv.y * 6.0) * 0.5 + 0.5));
  col = mix(col, vec3f(0.99, 0.88, 0.60), waxShine * 0.4);
  let scuff = blotch(uv, vec2f(0.3 + fract(seed * 0.13) * 0.4, 0.35 + fract(seed * 0.07) * 0.3), 0.14, vec2f(0.8, 0.8), seed + 9.0);
  col = mix(col, skinLo * 0.75, scuff * 0.4);
  return sat3(col);
}
