// @material sodium_fog
// @slug sodium-fog
// @name Sodium Fog
// @board gradients
// @variant-labels Streetlamp, Tunnel, Parking Deck
// @kind gradient
// @tags gradients, sodium, fog
// @author legacy
fn sodium_fog(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lamp = vec3f(1.00, 0.56, 0.18);
  if (variant > 0.5 && variant < 1.5) { lamp = vec3f(0.95, 0.74, 0.36); }
  else if (variant >= 1.5) { lamp = vec3f(0.60, 0.62, 0.70); }
  let glow = exp(-length((uv - vec2f(0.5, 0.85)) * vec2f(1.0, 1.6)) * 3.2);
  let haze = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.05, 0.045, 0.035), lamp, glow * 0.85 + haze * 0.18);
  col = mix(col, vec3f(0.02, 0.02, 0.025), smoothstep(0.0, 0.25, uv.y) * 0.45);
  return sat3(col);
}
