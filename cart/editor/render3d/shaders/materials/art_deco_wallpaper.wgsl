// @material art_deco_wallpaper
// @slug art-deco-wallpaper
// @name Art Deco Paper
// @board wallpapers
// @variant-labels Gold Fan, Teal Fan, Noir Fan
// @kind surface
// @tags wallpapers, art, deco
// @author legacy
fn art_deco_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.12, 0.10, 0.08);
  var line_col = vec3f(0.86, 0.64, 0.24);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.04, 0.26, 0.28); line_col = vec3f(0.86, 0.78, 0.48); }
  else if (variant >= 1.5) { bg = vec3f(0.03, 0.03, 0.04); line_col = vec3f(0.54, 0.50, 0.42); }
  var col = bg + vec3f((fbm(uv.x * 22.0, uv.y * 22.0 + seed, 4.0) - 0.5) * 0.035);
  let repeat = fract(uv * vec2f(4.0, 4.0)) - vec2f(0.5, 0.0);
  let r = length(repeat * vec2f(1.0, 1.6));
  let fan_a = line_near(r - 0.22, 0.018);
  let fan_b = line_near(r - 0.36, 0.014);
  let ray = line_near(sin(atan2(repeat.y, repeat.x) * 7.0), 0.08) * step(0.0, repeat.y);
  let panel = max(line_near(fract(uv.x * 4.0) - 0.5, 0.018), line_near(fract(uv.y * 4.0) - 0.5, 0.018));
  col = mix(col, line_col, sat(fan_a + fan_b + ray * 0.65 + panel * 0.45));
  return sat3(col);
}
