// @material asphalt_crime
// @slug asphalt-crime
// @name Asphalt Crime
// @board street_ground
// @variant-labels Fresh Spread, Old Spread, Polymer Spread
// @kind surface
// @tags street_ground, asphalt, skid, residue
// @author editor
fn asphalt_crime(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.17, 0.17, 0.18);
  var stain = vec3f(0.80, 0.75, 0.65);
  var oil = vec3f(0.09, 0.09, 0.11);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.12, 0.12, 0.13);
    stain = vec3f(0.70, 0.60, 0.40);
    oil = vec3f(0.16, 0.16, 0.18);
  } else if (variant >= 1.5) {
    base = vec3f(0.24, 0.24, 0.25);
    stain = vec3f(0.89, 0.70, 0.55);
    oil = vec3f(0.05, 0.07, 0.09);
  }
  let band = fbm(uv.x * 7.0 + seed, uv.y * 3.0 - seed, 5.0) * 0.5 + 0.5;
  let scuff = crack_field(uv + vec2f(seed * 0.13, 0.0), seed + 12.0, 11.0);
  var col = mix(base, stain, band * 0.22);
  col = mix(col, oil, scuff * 0.4);
  let stripe = 1.0 - smoothstep(0.035, 0.045, abs(uv.y - (0.35 + rand(vec2f(seed, 0.0)) * 0.22)));
  col = mix(col, vec3f(0.9, 0.9, 0.92), stripe * 0.35);
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 2.7, seed + 1.0, 0.965);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 1.8, seed + 5.0, 0.94);
  return sat3(col);
}
