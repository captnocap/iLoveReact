// @material fluorescent_panel
// @slug fluorescent-panel
// @name Fluorescent Panel
// @board gradients
// @variant-labels Office White, Sick Green, Flicker Pink
// @kind gradient
// @tags gradients, fluorescent, panel
// @author legacy
fn fluorescent_panel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = vec3f(0.90, 0.94, 0.88);
  if (variant > 0.5 && variant < 1.5) { col = vec3f(0.62, 0.90, 0.62); }
  else if (variant >= 1.5) { col = vec3f(0.98, 0.58, 0.78); }
  let frame = max(line_near(uv.x - 0.08, 0.008), line_near(uv.x - 0.92, 0.008)) + max(line_near(uv.y - 0.10, 0.008), line_near(uv.y - 0.90, 0.008));
  let tubes = max(line_near(uv.x - 0.36, 0.030), line_near(uv.x - 0.64, 0.030));
  let flicker = 0.85 + 0.15 * sin(U.time * 24.0 + seed) * step(1.5, variant);
  col = col * flicker + vec3f(tubes * 0.18);
  col = mix(col, vec3f(0.24, 0.24, 0.22), sat(frame));
  return sat3(col);
}
