// @material motel_wallpaper
// @slug motel-wallpaper
// @name Motel Wallpaper
// @board wallpapers
// @variant-labels Palm, Sunburst, Cigarette Tan
// @kind surface
// @tags wallpapers, motel, wallpaper
// @author legacy
fn motel_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = wallpaper_base(uv, px, seed, vec3f(0.68, 0.48, 0.32), vec3f(0.12, 0.34, 0.28), vec3f(0.88, 0.54, 0.18), 0.0);
  if (variant > 0.5 && variant < 1.5) { col = wallpaper_base(uv, px, seed, vec3f(0.40, 0.18, 0.28), vec3f(0.96, 0.58, 0.16), vec3f(0.86, 0.24, 0.34), 2.0); }
  else if (variant >= 1.5) { col = wallpaper_base(uv, px, seed, vec3f(0.58, 0.46, 0.34), vec3f(0.38, 0.28, 0.18), vec3f(0.92, 0.72, 0.42), 1.0); }
  return sat3(mix(col, vec3f(0.18, 0.13, 0.09), smoothstep(0.70, 1.0, uv.y) * 0.25));
}
