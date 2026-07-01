// @material office_wallcover
// @slug office-wallcover
// @name Office Wallcover
// @board wallpapers
// @variant-labels Cubicle Grey, Beige Weave, Conference Blue
// @kind surface
// @tags wallpapers, office, wallcover
// @author legacy
fn office_wallcover(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.46, 0.48, 0.48);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.66, 0.60, 0.50); }
  else if (variant >= 1.5) { bg = vec3f(0.24, 0.34, 0.54); }
  var col = bg + vec3f((fbm(uv.x * 26.0, uv.y * 26.0 + seed, 5.0) - 0.5) * 0.06);
  let weave = max(line_near(sin(uv.x * 160.0), 0.10), line_near(sin(uv.y * 120.0), 0.10));
  col = mix(col, bg * 0.72, weave * 0.20);
  return sat3(col);
}
