// @material grime_gradient
// @slug grime-gradient
// @name Grime Gradient
// @board gradients
// @variant-labels Top Soot, Bottom Mold, Corner Dirt
// @kind gradient
// @tags gradients, grime, gradient
// @author legacy
fn grime_gradient(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var clean = vec3f(0.64, 0.62, 0.54);
  var dirty = vec3f(0.08, 0.07, 0.05);
  let top = smoothstep(0.45, 1.0, uv.y);
  let bottom = 1.0 - smoothstep(0.0, 0.55, uv.y);
  let corner = smoothstep(0.55, 1.0, 1.0 - length(uv - vec2f(0.0, 0.0)));
  let mask = select(top, bottom, variant > 0.5 && variant < 1.5);
  let mask2 = select(mask, corner, variant >= 1.5);
  if (variant > 0.5 && variant < 1.5) { dirty = vec3f(0.05, 0.16, 0.06); }
  else if (variant >= 1.5) { dirty = vec3f(0.15, 0.10, 0.06); }
  var col = mix(clean, dirty, mask2 * (0.55 + fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.25));
  col = mix(col, dirty, vertical_drips(uv, seed, 1.0) * 0.30);
  return sat3(col);
}
