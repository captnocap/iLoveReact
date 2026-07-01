// @material cinder_block
// @slug cinder-block
// @name Cinder Block
// @board wood_brick_stone
// @variant-labels Raw Grey, Painted Cream, Tagged Blue
// @kind surface
// @tags wood_brick_stone, cinder, block
// @author legacy
fn cinder_block(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let g = uv * vec2f(3.0, 6.0);
  let row = floor(g.y);
  let off = (row - floor(row * 0.5) * 2.0) * 0.5;
  let l = fract(vec2f(g.x + off, g.y));
  let mortar = max(1.0 - smoothstep(0.025, 0.060, min(l.x, 1.0 - l.x)), 1.0 - smoothstep(0.025, 0.060, min(l.y, 1.0 - l.y)));
  var col = mix(vec3f(0.38, 0.38, 0.36), vec3f(0.68, 0.68, 0.64), fbm(uv.x * 18.0, uv.y * 18.0 + seed, 4.0) * 0.5 + 0.5);
  if (variant > 0.5 && variant < 1.5) { col = mix(col, vec3f(0.78, 0.72, 0.60), 0.45); }
  else if (variant >= 1.5) {
    col = mix(col, vec3f(0.18, 0.30, 0.55), 0.35);
    col = mix(col, vec3f(0.95, 0.18, 0.36), blotch(uv, vec2f(0.45, 0.38), 0.15, vec2f(1.5, 0.8), seed) * 0.5);
  }
  col = mix(col, vec3f(0.25, 0.25, 0.23), mortar * 0.85);
  return sat3(col);
}
