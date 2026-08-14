// @atom warp_swirl
// @name Swirl
// @kind warp
// @tags rotate, vortex, domain
// @author lab
fn warp_swirl(uv: vec2f, seed: f32, amount: f32) -> vec2f {
  let center = vec2f(0.5, 0.5);
  let p = uv - center;
  let r = length(p);
  let angle = (1.0 - sat(r * 2.0)) * amount * 3.1415926;
  let s = sin(angle);
  let c = cos(angle);
  return center + vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}
