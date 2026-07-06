// @material parapet_rift
// @slug parapet-rift
// @name Parapet Rift
// @board facades
// @variant-labels Chalk Cut, Rust Edge, Deep Split
// @kind surface
// @tags facades, parapet, crack, masonry
// @author editor
fn parapet_rift(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var plaster = vec3f(0.75, 0.73, 0.70);
  var dust = vec3f(0.62, 0.55, 0.50);
  var rust = vec3f(0.68, 0.33, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    plaster = vec3f(0.66, 0.64, 0.66);
    dust = vec3f(0.84, 0.82, 0.81);
    rust = vec3f(0.77, 0.41, 0.22);
  } else if (variant >= 1.5) {
    plaster = vec3f(0.78, 0.70, 0.64);
    dust = vec3f(0.86, 0.60, 0.48);
    rust = vec3f(0.54, 0.11, 0.08);
  }
  let map = brick_wall(uv, px, plaster, dust, vec3f(0.45, 0.42, 0.40), seed);
  let split = 1.0 - smoothstep(0.004, 0.032, abs((uv.x - 0.5) * 0.9 + sin(uv.y * 21.0 + seed) * 0.02));
  var col = mix(map, rust, split);
  let fissure = crack_field(uv, seed + 2.0, 12.0);
  col = mix(col, vec3f(0.30, 0.20, 0.12), fissure * 0.35);
  col = col + vec3f(0.03, 0.02, 0.01) * speckle(px, 1.8, seed + 9.0, 0.965);
  return sat3(col);
}
