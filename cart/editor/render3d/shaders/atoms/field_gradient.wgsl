// @atom field_gradient
// @name Vertical Gradient
// @kind field
// @tags gradient, directional, mask
// @author lab
fn field_gradient(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return sat(uv.y);
}
