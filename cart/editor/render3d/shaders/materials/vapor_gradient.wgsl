// @material vapor_gradient
// @slug vapor-gradient
// @name Vapor Gradient
// @board gradients
// @variant-labels Cyan Magenta, Acid Lime, Deep Violet
// @kind gradient
// @tags gradients, vapor, gradient
// @author legacy
fn vapor_gradient(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var a = vec3f(0.00, 0.86, 1.00); var b = vec3f(1.00, 0.10, 0.72);
  if (variant > 0.5 && variant < 1.5) { a = vec3f(0.70, 1.00, 0.05); b = vec3f(0.10, 0.04, 0.20); }
  else if (variant >= 1.5) { a = vec3f(0.16, 0.04, 0.44); b = vec3f(0.94, 0.30, 0.96); }
  let w = 0.5 + 0.5 * sin((uv.x + uv.y) * 5.0 + fbm(uv.x * 4.0, uv.y * 4.0 + seed, 4.0) * 3.0);
  var col = mix(a, b, w);
  let grid = max(line_near(fract(uv.x * 10.0) - 0.5, 0.020), line_near(fract(uv.y * 10.0) - 0.5, 0.020));
  col = mix(col, vec3f(0.02, 0.02, 0.04), grid * 0.18);
  return sat3(col);
}
