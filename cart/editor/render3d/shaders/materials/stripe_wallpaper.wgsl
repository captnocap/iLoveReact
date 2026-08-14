// @material stripe_wallpaper
// @slug stripe-wallpaper
// @name Stripe Wallpaper
// @board wallpapers
// @variant-labels Hotel Red, Hospital Mint, Navy Gold
// @kind surface
// @tags wallpapers, stripe, wallpaper
// @author legacy
fn stripe_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.54, 0.12, 0.16); var ink = vec3f(0.88, 0.76, 0.52); var acc = vec3f(0.18, 0.08, 0.06);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.62, 0.78, 0.68); ink = vec3f(0.88, 0.92, 0.84); acc = vec3f(0.26, 0.44, 0.36); }
  else if (variant >= 1.5) { bg = vec3f(0.08, 0.16, 0.34); ink = vec3f(0.84, 0.68, 0.24); acc = vec3f(0.04, 0.05, 0.08); }
  return wallpaper_base(uv, px, seed, bg, ink, acc, 1.0);
}
