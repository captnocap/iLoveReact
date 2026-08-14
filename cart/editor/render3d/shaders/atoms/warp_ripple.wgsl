// @atom warp_ripple
// @name Ripple
// @kind warp
// @tags waves, sine, domain
// @author lab
fn warp_ripple(uv: vec2f, seed: f32, amount: f32) -> vec2f {
  return uv + vec2f(sin(uv.y * 22.0 + seed), sin(uv.x * 22.0 - seed)) * amount * 0.04;
}
