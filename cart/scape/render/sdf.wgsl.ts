// Shared WGSL SDF helpers. One source so the ground shader and the HUD item-icon
// shader can't drift: a box/circle field, an antialiased shade(), and premultiplied
// over() compositing. Pure helpers, no bindings — safe to interpolate into any
// shader's top level.

export const SDF_HELPERS_WGSL = `
fn sdBox(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn sdCirc(p: vec2f, rr: f32) -> f32 { return length(p) - rr; }
fn shade(d: f32, fill: vec3f, line: vec3f) -> vec4f {
  let a = 1.0 - smoothstep(0.0, 1.4, d);
  let fr = smoothstep(-2.2, -0.4, d);
  return vec4f(mix(fill, line, fr), a);
}
fn over(dst: vec4f, src: vec4f) -> vec4f {
  let a = src.a + dst.a * (1.0 - src.a);
  let rgb = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / max(a, 0.0001);
  return vec4f(rgb, a);
}`;
