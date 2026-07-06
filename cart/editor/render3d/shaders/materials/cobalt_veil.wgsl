// @material cobalt_veil
// @slug cobalt-veil
// @name Cobalt Veil
// @board neon_surface
// @variant-labels Frost Veil, Bright Veil, Burn Veil
// @kind surface
// @tags neon_surface, cobalt, glow, polish
// @author editor
fn cobalt_veil(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var cold = vec3f(0.07, 0.14, 0.31);
  var bloom = vec3f(0.34, 0.63, 0.98);
  var fire = vec3f(0.90, 0.30, 0.22);
  if (variant > 0.5 && variant < 1.5) {
    cold = vec3f(0.10, 0.10, 0.20);
    bloom = vec3f(0.70, 0.42, 0.99);
    fire = vec3f(0.88, 0.56, 0.95);
  } else if (variant >= 1.5) {
    cold = vec3f(0.16, 0.13, 0.23);
    bloom = vec3f(0.14, 0.89, 0.86);
    fire = vec3f(0.95, 0.44, 0.40);
  }
  let wash = fbm(uv.x * 3.7 + seed, uv.y * 4.2 + seed * 0.5, 4.0) * 0.5 + 0.5;
  let stripe = 1.0 - smoothstep(0.36, 0.49, abs(fract((uv.y * 9.0) + seed * 0.1) - 0.5));
  var col = mix(cold, bloom, wash * 0.67);
  col = mix(col, fire, stripe * 0.42);
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 2.0, seed + 4.0, 0.98) * (0.25 + variant * 0.15);
  col = col - vec3f(0.06, 0.06, 0.06) * speckle(px, 1.6, seed + 10.0, 0.94);
  return sat3(col);
}
