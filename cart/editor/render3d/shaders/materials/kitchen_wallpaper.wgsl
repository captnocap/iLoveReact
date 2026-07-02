// @material kitchen_wallpaper
// @slug kitchen-wallpaper
// @name Kitchen Wallpaper
// @board wallpapers
// @variant-labels Lemon Grid, Daisy Yellow, Cherry Cream
// @kind surface
// @tags wallpapers, kitchen, wallpaper
// @author legacy
fn kitchen_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.86, 0.82, 0.62);
  var ink = vec3f(0.90, 0.66, 0.10);
  var accent = vec3f(0.18, 0.38, 0.20);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.88, 0.78, 0.42); ink = vec3f(0.98, 0.92, 0.64); accent = vec3f(0.36, 0.50, 0.20); }
  else if (variant >= 1.5) { bg = vec3f(0.86, 0.78, 0.66); ink = vec3f(0.72, 0.06, 0.08); accent = vec3f(0.20, 0.42, 0.18); }
  var col = bg;
  let grid = max(line_near(fract(uv.x * 6.0) - 0.5, 0.025), line_near(fract(uv.y * 6.0) - 0.5, 0.025));
  col = mix(col, bg * 0.72, grid * 0.35);
  let spot = fract(uv * vec2f(5.0, 5.0)) - vec2f(0.5, 0.5);
  let fruit = 1.0 - smoothstep(0.10, 0.16, length(spot * vec2f(1.2, 0.9)));
  let stem = line_near(spot.x + spot.y * 0.6, 0.022) * step(0.0, spot.y);
  col = mix(col, ink, fruit * 0.68);
  col = mix(col, accent, stem * 0.72);
  return sat3(col + vec3f((fbm(uv.x * 18.0, uv.y * 18.0 + seed, 4.0) - 0.5) * 0.035));
}
