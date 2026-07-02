// @material brushed_steel
// @slug brushed-steel
// @name Brushed Steel
// @board metal_yard
// @variant-labels Horizontal, Vertical, Circular
// @kind surface
// @tags metal_yard, brushed, steel
// @author legacy
fn brushed_steel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let axis = select(uv.x, uv.y, variant > 0.5 && variant < 1.5);
  var grain = line_near(sin(axis * 260.0 + fbm(uv.x * 8.0, uv.y * 8.0 + seed, 3.0) * 5.0), 0.18);
  if (variant >= 1.5) {
    let p = uv - vec2f(0.5, 0.5);
    grain = line_near(sin(length(p) * 220.0 + atan2(p.y, p.x) * 5.0), 0.16);
  }
  var col = mix(vec3f(0.34, 0.35, 0.35), vec3f(0.82, 0.84, 0.82), fbm(uv.x * 9.0, uv.y * 9.0, 4.0) * 0.5 + 0.5);
  col = col + vec3f(grain * 0.16);
  return sat3(col);
}
