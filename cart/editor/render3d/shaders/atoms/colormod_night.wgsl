// @atom colormod_night
// @name Night
// @kind colormod
// @tags color, mood, filter
// @author lab
fn colormod_night(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32) -> vec3f {
  let cooled = sat3(col * vec3f(0.30, 0.38, 0.62) + vec3f(0.010, 0.014, 0.045));
  return mix(col, cooled, sat(amount));
}
