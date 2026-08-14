// @material radio_waves
// @slug radio-waves
// @name Radio Waves
// @board neon_rot
// @variant-labels Faint Sweep, Bright Sweep, Saturated Sweep
// @kind surface
// @tags neon_rot, radio, sine, waves
// @author editor
fn radio_waves(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.09, 0.04, 0.16);
  var wave = vec3f(0.40, 0.92, 0.98);
  var noise = vec3f(0.90, 0.38, 0.96);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.05, 0.04, 0.12);
    wave = vec3f(0.96, 0.98, 0.98);
    noise = vec3f(0.40, 0.70, 0.97);
  } else if (variant >= 1.5) {
    base = vec3f(0.02, 0.00, 0.04);
    wave = vec3f(0.74, 0.32, 0.97);
    noise = vec3f(0.96, 0.56, 0.56);
  }
  let fm = sin(U.time * 7.0 + uv.x * 22.0 + seed * 1.7);
  let sweep = 1.0 - smoothstep(0.14, 0.20, abs(sin((uv.y + fm * 0.2) * 44.0 + seed * 1.5) - 0.5));
  let pulse = fbm(uv.x * 4.0 + seed, uv.y * 6.0 + seed * 0.2, 4.0) * 0.5 + 0.5;
  var col = mix(base, wave, smoothstep(0.35, 0.78, pulse));
  col = mix(col, noise, sweep * 0.6);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.3, seed + 5.0, 0.965) * (0.3 + 0.2 * variant);
  col = col - vec3f(0.05, 0.05, 0.05) * speckle(px, 1.4, seed + 9.0, 0.94);
  return sat3(col);
}
