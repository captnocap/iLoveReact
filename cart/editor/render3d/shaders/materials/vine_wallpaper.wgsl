// @material vine_wallpaper
// @slug vine-wallpaper
// @name Vine Wallpaper
// @board wallpapers
// @variant-labels Ivy Cream, Wisteria, Black Vine
// @kind surface
// @tags wallpapers, vine, wallpaper
// @author legacy
fn vine_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.78, 0.74, 0.62);
  var vine = vec3f(0.18, 0.36, 0.16);
  var flower = vec3f(0.84, 0.72, 0.42);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.50, 0.42, 0.62); vine = vec3f(0.28, 0.18, 0.40); flower = vec3f(0.76, 0.58, 0.96); }
  else if (variant >= 1.5) { bg = vec3f(0.06, 0.07, 0.08); vine = vec3f(0.28, 0.38, 0.22); flower = vec3f(0.72, 0.70, 0.56); }
  var col = bg + vec3f((fbm(uv.x * 20.0, uv.y * 20.0 + seed, 4.0) - 0.5) * 0.04);
  let wave = sin(uv.y * 18.0 + sin(uv.x * 11.0 + seed) * 2.0);
  let stem = line_near(fract(uv.x * 4.0 + wave * 0.12) - 0.5, 0.030);
  let leaves = line_near(sin((uv.x + uv.y) * 42.0 + seed), 0.12) * stem;
  col = mix(col, vine, max(stem * 0.55, leaves * 0.78));
  let blossom = speckle(px, 8.0, seed, 0.965) * smoothstep(0.30, 0.90, leaves);
  col = mix(col, flower, blossom * 0.75);
  return sat3(col);
}
