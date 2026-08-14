// @atom warp_fbm
// @name FBM Warp
// @kind warp
// @tags noise, organic, domain
// @author lab
fn warp_fbm(uv: vec2f, seed: f32, amount: f32) -> vec2f {
  let dx = fbm(uv.x * 4.0 + seed, uv.y * 4.0 - seed, 4.0);
  let dy = fbm(uv.x * 4.0 - seed + 9.0, uv.y * 4.0 + seed + 3.0, 4.0);
  return uv + vec2f(dx, dy) * amount * 0.5;
}
