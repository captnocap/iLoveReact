// @atom field_speckle
// @name Speckle
// @kind field
// @tags grain, dots, mask
// @author lab
// @param sparsity: f32 = 0.90 range(0.5, 0.99) "Speckle sparsity"
fn field_speckle(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return speckle(px, 3.0, seed, sparsity);
}
