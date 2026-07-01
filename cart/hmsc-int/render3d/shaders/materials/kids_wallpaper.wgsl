// @material kids_wallpaper
// @slug kids-wallpaper
// @name Kids Wallpaper
// @board wallpapers
// @variant-labels Stars, Clouds, Alphabet
// @kind surface
// @tags wallpapers, kids, wallpaper
// @author legacy
fn kids_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.20, 0.28, 0.58); var ink = vec3f(0.96, 0.90, 0.40); var acc = vec3f(0.95, 0.55, 0.70);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.62, 0.78, 0.92); ink = vec3f(0.98, 0.98, 0.96); acc = vec3f(0.36, 0.56, 0.86); }
  else if (variant >= 1.5) { bg = vec3f(0.82, 0.78, 0.58); ink = vec3f(0.18, 0.32, 0.54); acc = vec3f(0.86, 0.24, 0.22); }
  return wallpaper_base(uv, px, seed, bg, ink, acc, 3.0);
}
