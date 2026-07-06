// @material copper_rain
// @slug copper-rain
// @name Copper Rain
// @board street_ground
// @variant-labels Dry Deltas, Wet Streak, Gloss Drainage
// @kind surface
// @tags street_ground, copper, stain, runoff
// @author editor
fn copper_rain(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.18, 0.18, 0.20);
  var rust = vec3f(0.52, 0.32, 0.19);
  var sheen = vec3f(0.90, 0.72, 0.41);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.15, 0.15, 0.16);
    rust = vec3f(0.67, 0.38, 0.16);
    sheen = vec3f(0.76, 0.42, 0.18);
  } else if (variant >= 1.5) {
    base = vec3f(0.22, 0.20, 0.22);
    rust = vec3f(0.75, 0.45, 0.21);
    sheen = vec3f(1.00, 0.76, 0.31);
  }
  let runoff = 1.0 - smoothstep(0.05, 0.12, abs(uv.x - (0.3 + sin(uv.y * 8.0 + seed) * 0.13)));
  let spatter = vertical_drips(uv, seed + 5.0, 1.6);
  var col = mix(base, rust, fbm(uv.x * 7.0 + seed, uv.y * 6.0, 4.0) * 0.28);
  col = mix(col, sheen, (runoff + spatter) * 0.48);
  col = col + vec3f(0.03, 0.02, 0.01) * crack_field(uv + vec2f(seed * 0.05, 0.0), seed + 11.0, 18.0);
  col = col - vec3f(0.05, 0.04, 0.04) * speckle(px, 2.8, seed + 14.0, 0.945);
  return sat3(col);
}
