// @material sunset_gradient
// @slug sunset-gradient
// @name Sunset Gradient
// @board gradients
// @variant-labels Miami Pink, Sodium Orange, Purple Night
// @kind gradient
// @tags gradients, sunset, gradient
// @author legacy
fn sunset_gradient(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var top = vec3f(0.08, 0.04, 0.20); var mid = vec3f(0.92, 0.28, 0.48); var bot = vec3f(1.00, 0.58, 0.18);
  if (variant > 0.5 && variant < 1.5) { top = vec3f(0.20, 0.06, 0.02); mid = vec3f(0.90, 0.42, 0.10); bot = vec3f(0.98, 0.74, 0.22); }
  else if (variant >= 1.5) { top = vec3f(0.04, 0.02, 0.12); mid = vec3f(0.30, 0.08, 0.42); bot = vec3f(0.70, 0.18, 0.72); }
  let t = smoothstep(0.0, 1.0, uv.y);
  let col = mix(mix(bot, mid, smoothstep(0.0, 0.55, t)), top, smoothstep(0.45, 1.0, t));
  return sat3(col + vec3f((fbm(uv.x * 5.0, uv.y * 5.0 + seed, 4.0) - 0.5) * 0.04));
}
