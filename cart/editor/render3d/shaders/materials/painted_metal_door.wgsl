// @material painted_metal_door
// @slug painted-metal-door
// @name Painted Metal Door
// @board metal_yard
// @variant-labels Green Exit, Red Service, Grey Fire
// @kind surface
// @tags metal_yard, painted, metal
// @author legacy
fn painted_metal_door(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paint = vec3f(0.12, 0.42, 0.24);
  if (variant > 0.5 && variant < 1.5) { paint = vec3f(0.62, 0.12, 0.10); }
  else if (variant >= 1.5) { paint = vec3f(0.44, 0.46, 0.46); }
  var col = paint * (0.75 + 0.25 * fbm(uv.x * 12.0, uv.y * 12.0 + seed, 4.0));
  let panel = rect_mask(uv, 0.18, 0.82, 0.14, 0.84, 0.006);
  let inset = rect_mask(uv, 0.24, 0.76, 0.24, 0.74, 0.006);
  col = mix(col * 0.72, col, panel);
  col = mix(col, col * 0.58, inset * 0.35);
  let push = rect_mask(uv, 0.58, 0.74, 0.42, 0.50, 0.004);
  let vent = rect_mask(uv, 0.28, 0.48, 0.62, 0.76, 0.004);
  col = mix(col, vec3f(0.18, 0.18, 0.18), max(push, vent));
  let louvers = line_near(sin(uv.y * 90.0), 0.08) * vent;
  col = mix(col, vec3f(0.05, 0.05, 0.05), louvers);
  return sat3(col);
}
