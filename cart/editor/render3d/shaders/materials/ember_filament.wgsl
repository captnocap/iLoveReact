// @material ember_filament
// @slug ember-filament
// @name Ember Filament
// @board props
// @variant-labels Fine Filament, Dense Filament, Burnt Filament
// @kind surface
// @tags props, ember, filament, filament
// @author editor
fn ember_filament(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var dark = vec3f(0.22, 0.16, 0.10);
  var ember = vec3f(0.96, 0.46, 0.14);
  var smoke = vec3f(0.12, 0.10, 0.08);
  if (variant > 0.5 && variant < 1.5) {
    dark = vec3f(0.20, 0.14, 0.09);
    ember = vec3f(0.90, 0.56, 0.17);
    smoke = vec3f(0.32, 0.26, 0.21);
  } else if (variant >= 1.5) {
    dark = vec3f(0.14, 0.10, 0.08);
    ember = vec3f(1.00, 0.76, 0.18);
    smoke = vec3f(0.58, 0.46, 0.33);
  }
  let fil = 1.0 - smoothstep(0.10, 0.14, abs(fract((uv.y + seed * 0.13) * 22.0 + sin((uv.x + seed) * 18.0) * 0.12) - 0.5));
  let heat = 0.5 + 0.5 * sin(U.time * 4.0 + uv.x * 21.0 + seed * 2.0);
  let burn = crack_field(uv, seed + 4.0, 14.0);
  var col = mix(dark, ember, (fil + heat * 0.2) * 0.5);
  col = mix(col, smoke, burn * 0.45);
  col = col + vec3f(0.04, 0.02, 0.02) * speckle(px, 2.0, seed + 6.0, 0.98);
  col = col - vec3f(0.06, 0.06, 0.06) * speckle(px, 2.7, seed + 12.0, 0.94);
  return sat3(col);
}
