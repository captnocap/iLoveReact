// @atom field_leaf
// @name Leaf Cover
// @kind field
// @tags foliage, organic, mask
// @author lab
fn field_leaf(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return leaf_cover(uv, 0.55, seed);
}
