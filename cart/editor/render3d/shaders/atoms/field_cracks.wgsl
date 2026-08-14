// @atom field_cracks
// @name Cracks
// @kind field
// @tags cracks, damage, mask
// @author lab
// @param scale: f32 = 9.0 range(2.0, 24.0) "Crack scale"
fn field_cracks(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return crack_field(uv, seed, scale);
}
