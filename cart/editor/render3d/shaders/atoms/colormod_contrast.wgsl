// @atom colormod_contrast
// @name Contrast
// @kind colormod
// @tags color, contrast, filter
// @author lab
fn colormod_contrast(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32) -> vec3f {
  return sat3((col - vec3f(0.5, 0.5, 0.5)) * (1.0 + amount) + vec3f(0.5, 0.5, 0.5));
}
