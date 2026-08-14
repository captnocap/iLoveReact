// @material mirror_shards
// @slug mirror-shards
// @name Mirror Shards
// @board facades
// @variant-labels Dull Fracture, Glitter Fracture, Deep Fracture
// @kind surface
// @tags facades, mirror, glass, shards
// @author editor
fn mirror_shards(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var clear = vec3f(0.35, 0.35, 0.38);
  var silver = vec3f(0.82, 0.82, 0.84);
  var smoke = vec3f(0.10, 0.10, 0.11);
  if (variant > 0.5 && variant < 1.5) {
    clear = vec3f(0.43, 0.42, 0.45);
    silver = vec3f(0.98, 0.98, 1.00);
    smoke = vec3f(0.19, 0.19, 0.20);
  } else if (variant >= 1.5) {
    clear = vec3f(0.21, 0.21, 0.23);
    silver = vec3f(0.68, 0.67, 0.73);
    smoke = vec3f(0.30, 0.29, 0.32);
  }
  let breaks = 1.0 - smoothstep(0.012, 0.024, abs(fract((uv.x + uv.y * 0.7) * 80.0 + seed) - 0.5));
  let ripple = 1.0 - smoothstep(0.020, 0.035, abs(fbm(uv.x * 12.0 + seed, uv.y * 12.0, 4.0) - 0.5));
  var col = mix(clear, silver, sat(ripple) * 0.55);
  col = mix(col, smoke, breaks * 0.46);
  col = col + vec3f(0.10, 0.10, 0.10) * line_near(ripple, 0.12) * 0.35;
  col = col - vec3f(0.05, 0.05, 0.05) * speckle(px, 1.4, seed + 15.0, 0.94);
  return sat3(col);
}
