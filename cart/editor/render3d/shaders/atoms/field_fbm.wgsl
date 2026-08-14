// @atom field_fbm
// @name FBM Noise
// @kind field
// @tags noise, organic, mask
// @author lab
// @param scale: f32 = 6.0 range(1.0, 24.0) "Noise scale"
fn field_fbm(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  return sat(fbm(uv.x * scale + seed, uv.y * scale - seed, 4.0) * 0.5 + 0.5);
}
