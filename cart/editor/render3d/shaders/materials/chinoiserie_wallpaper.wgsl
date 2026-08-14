// @material chinoiserie_wallpaper
// @slug chinoiserie-wallpaper
// @name Chinoiserie Paper
// @board wallpapers
// @variant-labels Blue Porcelain, Green Birds, Ochre Scene
// @kind surface
// @tags wallpapers, chinoiserie, paper
// @author legacy
fn chinoiserie_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.82, 0.84, 0.78);
  var ink = vec3f(0.08, 0.25, 0.58);
  var accent = vec3f(0.72, 0.36, 0.18);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.72, 0.78, 0.58); ink = vec3f(0.08, 0.36, 0.24); accent = vec3f(0.82, 0.56, 0.24); }
  else if (variant >= 1.5) { bg = vec3f(0.78, 0.62, 0.36); ink = vec3f(0.36, 0.18, 0.08); accent = vec3f(0.08, 0.20, 0.28); }
  var col = bg + vec3f((fbm(uv.x * 16.0 + seed, uv.y * 16.0, 4.0) - 0.5) * 0.035);
  let branch = line_near(sin(uv.y * 11.0 + uv.x * 18.0 + seed), 0.06);
  let leaf = line_near(abs(fract((uv.x + uv.y * 0.5) * 8.0) - 0.5), 0.055) * smoothstep(0.15, 0.85, branch);
  let bird_body = 1.0 - smoothstep(0.055, 0.085, length((fract(uv * vec2f(3.0, 4.0)) - vec2f(0.42, 0.58)) * vec2f(1.4, 0.8)));
  let wing = line_near(sin((uv.x - uv.y) * 40.0), 0.08) * bird_body;
  col = mix(col, ink, max(branch * 0.55, leaf * 0.60));
  col = mix(col, accent, bird_body * 0.58);
  col = mix(col, ink * 0.55, wing * 0.65);
  return sat3(col);
}
