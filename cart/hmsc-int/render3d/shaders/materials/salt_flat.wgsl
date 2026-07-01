// @material salt_flat
// @slug salt-flat
// @name Salt Flat
// @board liminal
// @variant-labels White, Pink Lake, Borax
// @kind surface
// @tags liminal, salt, flat
// @author legacy
fn salt_flat(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Crusty salt pan with pressure ridges and mineral halos.
  let ridge_noise = fbm(uv.x * 4.5 + seed, uv.y * 4.5 - seed, 5.0);
  let ridge = line_near(ridge_noise, 0.030 + variant * 0.008);
  let salt = fbm(uv.x * 24.0 + seed, uv.y * 24.0, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.76, 0.74, 0.66), vec3f(0.94, 0.92, 0.84), salt);
  // Concentric mineral deposit rings — evaporation history.
  let rings = line_near(fract(length((uv - vec2f(0.48, 0.52)) * vec2f(1.3, 0.85)) * 5.5) - 0.5, 0.045);
  col = mix(col, vec3f(0.58, 0.54, 0.42), rings * 0.32);
  // Deep pressure cracks with shadow.
  col = mix(col, vec3f(0.14, 0.12, 0.10), ridge * 0.58);
  // Sun-bleached top, damp shadow bottom.
  col = col + vec3f(0.05, 0.04, 0.03) * (1.0 - smoothstep(0.25, 0.65, uv.y));
  // Variant colour shifts: 1 pink-lake, 2 borax-white.
  if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.82, 0.62, 0.64), 0.22);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.88, 0.88, 0.90), 0.18);
  }
  return sat3(col - vec3f(speckle(px, 2.8, seed, 0.93) * 0.05));
}
