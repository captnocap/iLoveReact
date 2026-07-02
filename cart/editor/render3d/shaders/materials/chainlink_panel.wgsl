// @material chainlink_panel
// @slug chainlink-panel
// @name Chainlink Panel
// @board metal_yard
// @variant-labels Fence, Razor Top, Privacy Slats
// @kind surface
// @tags metal_yard, chainlink, panel
// @author legacy
fn chainlink_panel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = mix(vec3f(0.09, 0.11, 0.10), vec3f(0.18, 0.21, 0.17), uv.y);
  let a = line_near(sin((uv.x + uv.y) * 44.0), 0.06);
  let b = line_near(sin((uv.x - uv.y) * 44.0), 0.06);
  let wire = max(a, b);
  col = mix(col, vec3f(0.58, 0.60, 0.56), wire * 0.90);
  if (variant > 0.5 && variant < 1.5) {
    let razor = line_near(sin(uv.x * 70.0), 0.10) * smoothstep(0.82, 1.0, uv.y);
    col = mix(col, vec3f(0.82, 0.82, 0.76), razor);
  } else if (variant >= 1.5) {
    let slat = step(0.5, fract(uv.x * 12.0));
    col = mix(col, vec3f(0.18, 0.35, 0.20), slat * 0.65);
  }
  return sat3(col);
}
