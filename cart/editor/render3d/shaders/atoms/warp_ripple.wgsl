// @atom warp_ripple
// @name Ripple
// @kind warp
// @tags waves, sine, domain
// @author lab
// @param frequency: f32 = 22.0 range(4.0, 60.0) "Wave frequency"
fn warp_ripple(uv: vec2f, seed: f32, amount: f32) -> vec2f {
  return uv + vec2f(sin(uv.y * frequency + seed), sin(uv.x * frequency - seed)) * amount * 0.04;
}
