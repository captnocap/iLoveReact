// @material clapboard_siding
// @slug clapboard-siding
// @name Clapboard Siding
// @board wood_brick_stone
// @variant-labels Whitewash, Seafoam, Rotten Tan
// @kind surface
// @tags wood_brick_stone, clapboard, siding
// @author legacy
fn clapboard_siding(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let row = floor(uv.y * 9.0);
  let l = fract(uv.y * 9.0);
  var paint = vec3f(0.82, 0.82, 0.76);
  if (variant > 0.5 && variant < 1.5) { paint = vec3f(0.38, 0.62, 0.58); }
  else if (variant >= 1.5) { paint = vec3f(0.62, 0.48, 0.34); }
  var col = paint * (0.80 + 0.20 * smoothstep(0.0, 1.0, l));
  col = col + vec3f((fbm(uv.x * 16.0 + seed, row + seed, 4.0) - 0.5) * 0.08);
  let shadow = 1.0 - smoothstep(0.020, 0.055, l);
  col = mix(col, col * 0.55, shadow);
  let peel = smoothstep(0.60, 0.82, fbm(uv.x * 6.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5) * step(1.5, variant);
  col = mix(col, vec3f(0.28, 0.19, 0.12), peel);
  return sat3(col);
}
