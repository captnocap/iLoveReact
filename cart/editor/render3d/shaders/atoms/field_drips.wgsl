// @atom field_drips
// @name Drips
// @kind field
// @tags weathering, streaks, mask
// @author lab
fn field_drips(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return vertical_drips(uv, seed, 1.0);
}
