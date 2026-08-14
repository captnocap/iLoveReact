// @atom colormod_hue
// @name Hue Shift
// @kind colormod
// @tags color, hue, filter
// @author lab
fn colormod_hue(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32) -> vec3f {
  let angle = amount * 6.2831853;
  let s = sin(angle);
  let c = cos(angle);
  let y = dot(col, vec3f(0.299, 0.587, 0.114));
  let i = dot(col, vec3f(0.596, -0.274, -0.322));
  let q = dot(col, vec3f(0.211, -0.523, 0.312));
  let i2 = i * c - q * s;
  let q2 = i * s + q * c;
  return sat3(vec3f(
    y + 0.956 * i2 + 0.621 * q2,
    y - 0.272 * i2 - 0.647 * q2,
    y - 1.106 * i2 + 1.703 * q2));
}
