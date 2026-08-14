// @material salted_mold
// @slug salted-mold
// @name Salted Mold
// @board condemned
// @variant-labels Damp Salt, Crust Bloom, Brine Bloom
// @kind surface
// @tags condemned, mold, salt, brine
// @author editor
fn salted_mold(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.27, 0.24, 0.19);
  var bloom = vec3f(0.61, 0.62, 0.40);
  var bloom2 = vec3f(0.22, 0.26, 0.18);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.24, 0.22, 0.17);
    bloom = vec3f(0.74, 0.71, 0.54);
    bloom2 = vec3f(0.26, 0.33, 0.23);
  } else if (variant >= 1.5) {
    base = vec3f(0.44, 0.42, 0.36);
    bloom = vec3f(0.58, 0.66, 0.38);
    bloom2 = vec3f(0.21, 0.30, 0.24);
  }
  let blot = fbm(uv.x * 6.0 + seed, uv.y * 6.0 + seed * 0.4, 4.0) * 0.5 + 0.5;
  let drip = vertical_drips(uv, seed * 0.8, 1.8);
  var col = mix(base, bloom, smoothstep(0.34, 0.58, blot));
  col = mix(col, bloom2, drip * 0.75);
  let salt = line_near(uv.y + 0.25 * sin(uv.x * 18.0 + seed), 0.025);
  col = mix(col, vec3f(0.94, 0.90, 0.78), salt * 0.18 * (seed + 0.2));
  col = col - vec3f(0.08, 0.07, 0.06) * speckle(px, 1.9, seed + 4.5, 0.94);
  col = col + vec3f(0.04, 0.06, 0.03) * speckle(px, 3.0, seed + 9.0, 0.982);
  return sat3(col);
}

