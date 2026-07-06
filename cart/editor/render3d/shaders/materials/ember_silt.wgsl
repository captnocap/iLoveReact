// @material ember_silt
// @slug ember-silt
// @name Ember Silt
// @board condemned
// @variant-labels Cinder Base, Brushed Cinder, Ember Drift
// @kind surface
// @tags condemned, ash, ember, silt
// @author editor
fn ember_silt(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.24, 0.17, 0.12);
  var ember = vec3f(0.74, 0.35, 0.15);
  var dust = vec3f(0.45, 0.30, 0.18);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.28, 0.20, 0.14);
    ember = vec3f(0.95, 0.50, 0.22);
    dust = vec3f(0.54, 0.36, 0.23);
  } else if (variant >= 1.5) {
    base = vec3f(0.17, 0.12, 0.09);
    ember = vec3f(0.99, 0.36, 0.11);
    dust = vec3f(0.20, 0.16, 0.10);
  }
  let drift = 1.0 - smoothstep(0.28, 0.44, abs(uv.y - (0.5 + sin(uv.x * 4.0 + seed) * 0.08)));
  let pore = speckle(px + vec2f(seed * 13.0, seed), 2.2, seed + 4.0, 0.95);
  var col = mix(base, ember, drift * 0.45);
  col = mix(col, dust, pore * 0.5);
  col = col + vec3f(0.06, 0.05, 0.04) * crack_field(uv + vec2f(seed * 0.14, 0.0), seed + 6.0, 10.0);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 3.0, seed + 12.0, 0.93);
  return sat3(col);
}
