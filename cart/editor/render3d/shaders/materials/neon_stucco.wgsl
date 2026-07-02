// @material neon_stucco
// @slug neon-stucco
// @name Neon Stucco
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, neon, stucco
// @author legacy
fn neon_stucco(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let stucco = fbm(uv.x * 28.0 + seed, uv.y * 28.0 - seed, 5.0) * 0.5 + 0.5;
  let larger = fbm(uv.x * 5.0 - seed, uv.y * 5.0 + seed, 4.0) * 0.5 + 0.5;
  var low = vec3f(0.50, 0.10, 0.24);
  var high = vec3f(0.98, 0.45, 0.66);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.07, 0.37, 0.42);
    high = vec3f(0.36, 0.92, 0.88);
  } else if (variant >= 1.5) {
    low = vec3f(0.26, 0.19, 0.46);
    high = vec3f(0.84, 0.68, 0.96);
  }
  var col = mix(low, high, stucco * 0.62 + larger * 0.18);
  col = col - vec3f(crack_field(uv, seed, 9.0) * 0.18);
  col = mix(col, vec3f(0.98, 0.78, 0.18), vertical_drips(uv, seed + 2.0, variant + 1.0) * 0.18);
  return neon_grime(uv, px, col, seed + 6.0, variant);
}
