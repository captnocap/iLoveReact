// @material fieldstone
// @slug fieldstone
// @name Fieldstone
// @board wood_brick_stone
// @variant-labels River Rock, Mossy, Dry Stack
// @kind surface
// @tags wood_brick_stone, fieldstone
// @author legacy
fn fieldstone(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let g = uv * vec2f(4.0, 5.0);
  let cell = floor(g);
  let l = fract(g) - vec2f(0.5, 0.5);
  let r = length(l * vec2f(1.0 + rand(cell + vec2f(seed, seed)) * 0.5, 0.8 + rand(cell + vec2f(seed + 4.0, seed - 4.0)) * 0.7));
  let mortar = smoothstep(0.34, 0.42, r);
  var lo = vec3f(0.28, 0.28, 0.25);
  var hi = vec3f(0.58, 0.56, 0.48);
  if (variant > 0.5 && variant < 1.5) { lo = vec3f(0.18, 0.26, 0.16); hi = vec3f(0.46, 0.52, 0.34); }
  else if (variant >= 1.5) { lo = vec3f(0.42, 0.34, 0.25); hi = vec3f(0.72, 0.62, 0.46); }
  var col = mix(lo, hi, rand(cell + vec2f(seed, seed)) * 0.6 + fbm(uv.x * 18.0, uv.y * 18.0, 4.0) * 0.2);
  col = mix(col, vec3f(0.42, 0.40, 0.34), mortar * 0.90);
  return sat3(col);
}
