// @atom field_cracks
// @name Cracks
// @kind field
// @tags cracks, damage, mask
// @author lab
fn field_cracks(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return crack_field(uv, seed, 9.0);
}
