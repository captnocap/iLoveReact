// @material rusted_panel
// @slug rusted-panel
// @name Rusted Panel
// @board metal_yard
// @variant-labels Orange Bloom, Black Rust, Peeling Paint
// @kind surface
// @tags metal_yard, rusted, panel
// @author legacy
fn rusted_panel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = corrugated_metal(uv, px, 0.0, seed) * 0.7;
  let rust = smoothstep(0.45, 0.78, fbm(uv.x * 6.0 + seed, uv.y * 6.0, 5.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.74, 0.28, 0.08), rust * 0.70);
  if (variant > 0.5 && variant < 1.5) { col = mix(col, vec3f(0.06, 0.05, 0.04), rust * 0.40); }
  else if (variant >= 1.5) { col = mix(col, vec3f(0.12, 0.32, 0.48), 0.34); col = mix(col, vec3f(0.90, 0.86, 0.72), crack_field(uv, seed, 9.0) * 0.45); }
  return sat3(col);
}
