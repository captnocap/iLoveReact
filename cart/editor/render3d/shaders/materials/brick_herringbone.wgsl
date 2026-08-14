// @material brick_herringbone
// @slug brick-herringbone
// @name Brick Herringbone
// @board wood_brick_stone
// @variant-labels Red Clay, Buff Clay, Sooted
// @kind surface
// @tags wood_brick_stone, brick, herringbone
// @author legacy
fn brick_herringbone(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let g = uv * vec2f(8.0, 8.0);
  let cell = floor(g);
  let l = fract(g);
  let flip = step(0.5, fract((cell.x + cell.y) * 0.5));
  let groove = select(min(l.x, 1.0 - l.x), min(l.y, 1.0 - l.y), flip > 0.5);
  let mortar = 1.0 - smoothstep(0.025, 0.055, groove);
  var col = brick(uv * vec2f(1.4, 1.4), px, variant, seed);
  col = mix(col, vec3f(0.50, 0.47, 0.40), mortar * 0.82);
  return sat3(col);
}
