// @material salt_bloom
// @slug salt-bloom
// @name Salt Bloom
// @board liminal
// @variant-labels Pale Bloom, Bright Bloom, Damp Bloom
// @kind surface
// @tags liminal, salt, bloom, crust
// @author editor
fn salt_bloom(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.80, 0.83, 0.86);
  var bloom = vec3f(0.96, 1.00, 0.96);
  var crust = vec3f(0.44, 0.47, 0.50);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.72, 0.75, 0.80);
    bloom = vec3f(1.00, 0.95, 0.87);
    crust = vec3f(0.57, 0.56, 0.54);
  } else if (variant >= 1.5) {
    base = vec3f(0.86, 0.82, 0.76);
    bloom = vec3f(0.96, 1.00, 0.90);
    crust = vec3f(0.25, 0.25, 0.24);
  }
  let salt = fbm(uv.x * 15.0 + seed, uv.y * 10.0 - seed, 5.0) * 0.5 + 0.5;
  let bloomMask = 1.0 - smoothstep(0.44, 0.56, abs(salt - 0.48));
  var col = mix(base, bloom, bloomMask * 0.7);
  col = mix(col, crust, crack_field(uv, seed + 6.0, 16.0) * 0.45);
  col = col + vec3f(0.04, 0.04, 0.03) * speckle(px, 1.5, seed + 8.0, 0.982);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 2.9, seed + 12.0, 0.942);
  return sat3(col);
}
