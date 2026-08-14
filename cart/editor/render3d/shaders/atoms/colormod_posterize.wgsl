// @atom colormod_posterize
// @name Posterize
// @kind colormod
// @tags color, quantize, filter
// @author lab
fn colormod_posterize(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32) -> vec3f {
  let levels = 6.0;
  let quantized = floor(col * levels + vec3f(0.5, 0.5, 0.5)) / levels;
  return mix(col, quantized, sat(amount));
}
