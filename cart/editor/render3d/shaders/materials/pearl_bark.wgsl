// @material pearl_bark
// @slug pearl-bark
// @name Pearl Bark
// @board wood_brick_stone
// @variant-labels Soft Pearl, Bright Pearl, Tarnished Pearl
// @kind surface
// @tags wood_brick_stone, pearl, bark, iridescent
// @author editor
fn pearl_bark(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.54, 0.41, 0.32);
  var sheen = vec3f(0.92, 0.88, 0.80);
  var shadow = vec3f(0.22, 0.17, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.60, 0.52, 0.45);
    sheen = vec3f(0.95, 0.98, 0.92);
    shadow = vec3f(0.28, 0.22, 0.17);
  } else if (variant >= 1.5) {
    base = vec3f(0.38, 0.28, 0.23);
    sheen = vec3f(0.74, 0.52, 0.38);
    shadow = vec3f(0.60, 0.55, 0.43);
  }
  let grain = fbm(uv.x * 5.5 + seed, uv.y * 7.8 + seed * 0.6, 5.0) * 0.5 + 0.5;
  let grainLines = 1.0 - smoothstep(0.18, 0.24, abs(fract((uv.x + uv.y) * 20.0 + seed * 0.5) - 0.5));
  var col = mix(base, sheen, smoothstep(0.20, 0.74, grain));
  col = mix(col, shadow, grainLines * 0.46);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.0, seed + 8.0, 0.965);
  col = col - vec3f(0.06, 0.06, 0.06) * speckle(px, 2.8, seed + 12.0, 0.94);
  return sat3(col);
}
