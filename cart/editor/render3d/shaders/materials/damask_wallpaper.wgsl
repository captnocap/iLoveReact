// @material damask_wallpaper
// @slug damask-wallpaper
// @name Damask Wallpaper
// @board wallpapers
// @variant-labels Gold, Burgundy, Smoke Black
// @kind surface
// @tags wallpapers, damask, wallpaper
// @author legacy
fn damask_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.46, 0.34, 0.14); var ink = vec3f(0.84, 0.66, 0.24); var acc = vec3f(0.14, 0.10, 0.05);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.34, 0.05, 0.10); ink = vec3f(0.78, 0.46, 0.42); acc = vec3f(0.10, 0.03, 0.04); }
  else if (variant >= 1.5) { bg = vec3f(0.06, 0.06, 0.07); ink = vec3f(0.34, 0.32, 0.30); acc = vec3f(0.62, 0.48, 0.24); }
  return wallpaper_base(uv, px, seed, bg, ink, acc, 2.0);
}
