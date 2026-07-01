// @material nursery_wallpaper
// @slug nursery-wallpaper
// @name Nursery Wallpaper
// @board wallpapers
// @variant-labels Moon Blue, Peach Bows, Mint Ducks
// @kind surface
// @tags wallpapers, nursery, wallpaper
// @author legacy
fn nursery_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.58, 0.72, 0.88);
  var ink = vec3f(0.94, 0.90, 0.70);
  var accent = vec3f(0.18, 0.28, 0.52);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.92, 0.66, 0.58); ink = vec3f(0.96, 0.78, 0.82); accent = vec3f(0.70, 0.22, 0.32); }
  else if (variant >= 1.5) { bg = vec3f(0.62, 0.82, 0.70); ink = vec3f(0.98, 0.92, 0.38); accent = vec3f(0.18, 0.44, 0.30); }
  var col = bg + vec3f((fbm(uv.x * 14.0 + seed, uv.y * 14.0, 4.0) - 0.5) * 0.035);
  let cell = fract(uv * vec2f(5.0, 5.0)) - vec2f(0.5, 0.5);
  let moon = (1.0 - smoothstep(0.12, 0.16, length(cell))) * (1.0 - (1.0 - smoothstep(0.09, 0.14, length(cell - vec2f(0.06, 0.03)))));
  let bow = max(1.0 - smoothstep(0.07, 0.11, length((cell - vec2f(-0.08, 0.02)) * vec2f(1.4, 0.8))), 1.0 - smoothstep(0.07, 0.11, length((cell - vec2f(0.08, 0.02)) * vec2f(1.4, 0.8))));
  let duck = (1.0 - smoothstep(0.10, 0.15, length((cell + vec2f(0.02, 0.02)) * vec2f(1.3, 0.8)))) * step(1.5, variant);
  let mark = select(moon, bow, variant > 0.5 && variant < 1.5);
  let mark2 = select(mark, duck, variant >= 1.5);
  col = mix(col, ink, mark2 * 0.72);
  col = mix(col, accent, speckle(px, 9.0, seed, 0.96) * 0.42);
  return sat3(col);
}
