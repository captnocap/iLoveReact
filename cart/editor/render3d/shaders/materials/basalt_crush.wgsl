// @material basalt_crush
// @slug basalt-crush
// @name Basalt Crush
// @board wood_brick_stone
// @variant-labels Dusted, Charred, Sheened
// @kind surface
// @tags wood_brick_stone, basalt, stone, cracked
// @author editor
fn basalt_crush(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var low = vec3f(0.24, 0.22, 0.20);
  var high = vec3f(0.41, 0.38, 0.33);
  var matte = vec3f(0.09, 0.08, 0.06);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.28, 0.26, 0.27);
    high = vec3f(0.47, 0.42, 0.38);
    matte = vec3f(0.13, 0.13, 0.12);
  } else if (variant >= 1.5) {
    low = vec3f(0.31, 0.29, 0.31);
    high = vec3f(0.20, 0.20, 0.17);
    matte = vec3f(0.44, 0.34, 0.22);
  }
  let grain = brick_wall(uv, px, low, high, matte, seed + 10.0);
  let fracture = line_near(sin(uv.x * 44.0 + uv.y * 2.0 + seed), 0.03 + variant * 0.003);
  var col = grain;
  col = mix(col, vec3f(0.55, 0.50, 0.40), fracture * 0.35);
  col = col + vec3f(0.03, 0.03, 0.03) * crack_field(uv + vec2f(seed, 0.0), seed + 2.0, 18.0);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 2.5, seed + 9.0, 0.95);
  return sat3(col);
}
