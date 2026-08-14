// @atom colormod_posterize
// @name Posterize
// @kind colormod
// @tags color, quantize, filter
// @author lab
// @param levels: f32 = 6.0 range(2.0, 16.0) "Levels"
fn colormod_posterize(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32) -> vec3f {
  let quantized = floor(col * levels + vec3f(0.5, 0.5, 0.5)) / levels;
  return mix(col, quantized, sat(amount));
}
