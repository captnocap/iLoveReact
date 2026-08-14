// @material toile_wallpaper
// @slug toile-wallpaper
// @name Toile Wallpaper
// @board wallpapers
// @variant-labels French Blue, Sepia Farm, Red Hunt
// @kind surface
// @tags wallpapers, toile, wallpaper
// @author legacy
fn toile_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.80, 0.80, 0.72);
  var ink = vec3f(0.08, 0.22, 0.52);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.76, 0.66, 0.50); ink = vec3f(0.36, 0.20, 0.10); }
  else if (variant >= 1.5) { bg = vec3f(0.78, 0.62, 0.58); ink = vec3f(0.58, 0.10, 0.12); }
  var col = bg + vec3f((fbm(uv.x * 18.0, uv.y * 18.0 + seed, 4.0) - 0.5) * 0.035);
  let hill = line_near(uv.y - (0.28 + sin(uv.x * 8.0 + seed) * 0.035), 0.020);
  let tree_trunk = line_near(fract(uv.x * 5.0) - 0.5, 0.018) * smoothstep(0.20, 0.65, uv.y) * (1.0 - smoothstep(0.65, 0.78, uv.y));
  let canopy = speckle(px, 7.5, seed, 0.88) * smoothstep(0.50, 0.82, uv.y);
  let figure = rect_mask(uv, 0.42, 0.47, 0.22, 0.42, 0.006) + rect_mask(uv, 0.54, 0.59, 0.22, 0.39, 0.006);
  let hatch = line_near(sin((uv.x + uv.y) * 95.0), 0.06);
  col = mix(col, ink, sat(hill * 0.6 + tree_trunk * 0.85 + canopy * 0.32 + figure * 0.75 + hatch * figure * 0.4));
  return sat3(col);
}
