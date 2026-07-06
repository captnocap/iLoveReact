// @material moonstone_glow
// @slug moonstone-glow
// @name Moonstone Sheen
// @board neon_surface
// @variant-labels Blue Adularia, Peach Body, Gray Cloud
// @kind gradient
// @tags neon_surface, moonstone, sheen, pale
// @author fable-gems_precious
fn moonstone_glow(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.87, 0.88, 0.90);
  var sheen = vec3f(0.55, 0.72, 1.0);
  var shadow_t = vec3f(0.62, 0.66, 0.74);
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.92, 0.82, 0.74); sheen = vec3f(1.0, 0.78, 0.60); shadow_t = vec3f(0.68, 0.58, 0.52);
  } else if (variant >= 1.5) {
    body = vec3f(0.72, 0.73, 0.76); sheen = vec3f(0.78, 0.86, 0.98); shadow_t = vec3f(0.48, 0.50, 0.55);
  }
  let cloud = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 5.0) * 0.5 + 0.5;
  var col = mix(shadow_t, body, cloud);
  let tilt = snoise(seed * 0.17, 1.1) * 0.25;
  let band_pos = uv.x * 0.7 + uv.y * 0.7 - 0.7 + tilt;
  let adular = exp(-band_pos * band_pos * 14.0);
  col = mix(col, sheen, adular * 0.60);
  col = mix(col, vec3f(0.98, 0.99, 1.0), adular * adular * 0.35);
  let lam = line_near(sin((uv.y + cloud * 0.1) * 40.0 + seed), 0.15);
  col = mix(col, col * 1.06, lam * adular * 0.6);
  let murk = smoothstep(0.60, 0.85, fbm(uv.x * 9.0, uv.y * 9.0 + seed * 2.1, 4.0) * 0.5 + 0.5);
  col = mix(col, shadow_t * 0.9, murk * 0.25);
  col += vec3f(0.94, 0.97, 1.0) * speckle(px, 2.0, seed, 0.998) * 0.2;
  return sat3(col);
}
