// @material wet_neon_fade
// @slug wet-neon-fade
// @name Wet Neon Fade
// @board gradients
// @variant-labels Pink Reflection, Blue Reflection, Oil Rainbow
// @kind gradient
// @tags gradients, wet, neon
// @author legacy
fn wet_neon_fade(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var neon = vec3f(1.00, 0.12, 0.62);
  if (variant > 0.5 && variant < 1.5) { neon = vec3f(0.10, 0.52, 1.00); }
  else if (variant >= 1.5) { neon = vec3f(0.80, 0.96, 0.22); }
  var col = mix(vec3f(0.015, 0.016, 0.018), neon * 0.65, smoothstep(0.0, 1.0, uv.y));
  let streak = vertical_drips(uv, seed, 1.0);
  let ripple = line_near(sin(uv.y * 80.0 + fbm(uv.x * 6.0, uv.y * 6.0 + seed, 4.0) * 5.0), 0.08);
  col = col + neon * streak * 0.35 + vec3f(0.08, 0.08, 0.10) * ripple;
  return sat3(col);
}
