// @atom field_speckle
// @name Speckle
// @kind field
// @tags grain, dots, mask
// @author lab
fn field_speckle(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return speckle(px, 3.0, seed, 0.90);
}
