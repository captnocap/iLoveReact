// @material acid_membrane
// @slug acid-membrane
// @name Acid Membrane
// @board neon_rot
// @variant-labels Green Burn, Amber Burn, White Burn
// @kind surface
// @tags neon_rot, acid, membrane, film
// @author editor
fn acid_membrane(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.12, 0.08, 0.16);
  var bloom = vec3f(0.25, 0.92, 0.47);
  var bleed = vec3f(0.88, 0.33, 0.14);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.10, 0.10, 0.12);
    bloom = vec3f(0.98, 0.98, 0.22);
    bleed = vec3f(0.28, 0.76, 0.97);
  } else if (variant >= 1.5) {
    base = vec3f(0.18, 0.18, 0.22);
    bloom = vec3f(0.95, 0.40, 0.98);
    bleed = vec3f(0.20, 0.93, 0.98);
  }
  let fog = fbm(uv.x * 6.0 + seed, uv.y * 6.0 + seed * 0.2, 4.0) * 0.5 + 0.5;
  var col = mix(base, bloom, smoothstep(0.35, 0.80, fog));
  let vein = line_near(sin(uv.x * 24.0 + uv.y * 10.0 + seed) * 0.5 + 0.5, 0.05);
  col = mix(col, bleed, vein * 0.45);
  let blobs = speckle(px, 2.4, seed + 3.0, 0.95);
  col = mix(col, vec3f(0.95, 0.86, 0.98), blobs * 0.28);
  let pulse = 0.5 + 0.5 * sin(U.time * 8.0 + uv.x * 16.0 + seed);
  col = col + vec3f(0.06, 0.06, 0.06) * pulse * speckle(px, 1.8, seed + 6.0, 0.985);
  return sat3(col);
}

