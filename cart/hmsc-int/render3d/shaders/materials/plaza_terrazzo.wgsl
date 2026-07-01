// @material plaza_terrazzo
// @slug plaza-terrazzo
// @name Plaza Terrazzo
// @board street_ground
// @variant-labels Speckled, Brass Inlay, Cracked
// @kind surface
// @tags street_ground, plaza, terrazzo
// @author legacy
fn plaza_terrazzo(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = mix(vec3f(0.56, 0.54, 0.50), vec3f(0.82, 0.80, 0.72), fbm(uv.x * 8.0, uv.y * 8.0 + seed, 4.0) * 0.5 + 0.5);
  let chip1 = speckle(px, 2.0, seed, 0.72);
  let chip2 = speckle(px + vec2f(8.0, 3.0), 3.0, seed, 0.82);
  base = mix(base, vec3f(0.20, 0.20, 0.22), chip1 * 0.35);
  base = mix(base, vec3f(0.74, 0.50, 0.34), chip2 * 0.35);
  if (variant > 0.5 && variant < 1.5) {
    let inlay = max(line_near(uv.x - 0.5, 0.006), line_near(uv.y - 0.5, 0.006));
    base = mix(base, vec3f(0.82, 0.62, 0.24), inlay);
  } else if (variant >= 1.5) {
    base = base - vec3f(crack_field(uv, seed, 10.0) * 0.25);
  }
  return sat3(base);
}
