// @atom field_fbm
// @name FBM Noise
// @kind field
// @tags noise, organic, mask
// @author lab
fn field_fbm(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return sat(fbm(uv.x * 6.0 + seed, uv.y * 6.0 - seed, 4.0) * 0.5 + 0.5);
}
