// @atom colormod_saturate
// @name Saturation
// @kind colormod
// @tags color, saturation, filter
// @author lab
fn colormod_saturate(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32) -> vec3f {
  let luma = dot(col, vec3f(0.299, 0.587, 0.114));
  return sat3(mix(vec3f(luma, luma, luma), col, 1.0 + amount));
}
