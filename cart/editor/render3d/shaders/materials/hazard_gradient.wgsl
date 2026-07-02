// @material hazard_gradient
// @slug hazard-gradient
// @name Hazard Gradient
// @board gradients
// @variant-labels Warning Stripe, Bio Spill, Police Tape
// @kind gradient
// @tags gradients, hazard, gradient
// @author legacy
fn hazard_gradient(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = mix(vec3f(0.96, 0.72, 0.10), vec3f(0.04, 0.04, 0.04), step(0.5, fract((uv.x + uv.y) * 8.0)));
  if (variant > 0.5 && variant < 1.5) { base = mix(vec3f(0.12, 0.90, 0.42), vec3f(0.06, 0.12, 0.08), smoothstep(0.0, 1.0, uv.y)); }
  else if (variant >= 1.5) { base = mix(vec3f(0.10, 0.18, 0.80), vec3f(0.98, 0.86, 0.16), step(0.5, fract(uv.x * 5.0))); }
  return sat3(base - vec3f(speckle(px, 3.0, seed, 0.94) * 0.10));
}
