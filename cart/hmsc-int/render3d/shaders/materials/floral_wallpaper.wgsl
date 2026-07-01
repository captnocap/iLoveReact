// @material floral_wallpaper
// @slug floral-wallpaper
// @name Floral Wallpaper
// @board wallpapers
// @variant-labels Rose, Avocado, Blue China
// @kind surface
// @tags wallpapers, floral, wallpaper
// @author legacy
fn floral_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.72, 0.60, 0.52); var ink = vec3f(0.72, 0.20, 0.30); var acc = vec3f(0.25, 0.42, 0.18);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.48, 0.56, 0.34); ink = vec3f(0.85, 0.68, 0.36); acc = vec3f(0.18, 0.30, 0.12); }
  else if (variant >= 1.5) { bg = vec3f(0.72, 0.78, 0.82); ink = vec3f(0.10, 0.30, 0.64); acc = vec3f(0.80, 0.70, 0.36); }
  return wallpaper_base(uv, px, seed, bg, ink, acc, 0.0);
}
