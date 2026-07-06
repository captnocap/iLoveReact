// @material plasma_rim
// @slug plasma-rim
// @name Plasma Rim
// @board neon_surface
// @variant-labels Cool Rim, Balanced Rim, Hot Rim
// @kind surface
// @tags neon_surface, plasma, rim, glow
// @author editor
fn plasma_rim(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var dusk = vec3f(0.12, 0.08, 0.18);
  var white = vec3f(0.80, 0.94, 0.99);
  var fire = vec3f(0.98, 0.28, 0.14);
  if (variant > 0.5 && variant < 1.5) {
    dusk = vec3f(0.16, 0.08, 0.24);
    white = vec3f(0.95, 0.70, 0.96);
    fire = vec3f(0.96, 0.45, 0.16);
  } else if (variant >= 1.5) {
    dusk = vec3f(0.34, 0.06, 0.09);
    white = vec3f(0.98, 0.38, 0.42);
    fire = vec3f(1.00, 0.10, 0.35);
  }
  let rim = 1.0 - smoothstep(0.20, 0.25, abs(length(uv - vec2f(0.5, 0.5)) - 0.42));
  let pulse = fbm(uv.x * 5.0 + seed + U.time * 0.3, uv.y * 7.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(dusk, white, pulse * 0.6);
  col = mix(col, fire, rim * (0.4 + pulse * 0.2));
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 1.9, seed + 7.0, 0.98);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 2.7, seed + 13.0, 0.94);
  return sat3(col);
}
