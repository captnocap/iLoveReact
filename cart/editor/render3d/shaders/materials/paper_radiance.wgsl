// @material paper_radiance
// @slug paper-radiance
// @name Paper Radiance
// @board wallpapers
// @variant-labels Warm Radiance, Cool Radiance, Amber Radiance
// @kind surface
// @tags wallpapers, paper, radiance, print
// @author editor
fn paper_radiance(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var page = vec3f(0.90, 0.86, 0.74);
  var ink = vec3f(0.28, 0.18, 0.12);
  var gloss = vec3f(0.98, 0.92, 0.68);
  if (variant > 0.5 && variant < 1.5) {
    page = vec3f(0.88, 0.86, 0.70);
    ink = vec3f(0.33, 0.22, 0.16);
    gloss = vec3f(0.99, 0.98, 0.83);
  } else if (variant >= 1.5) {
    page = vec3f(0.96, 0.80, 0.70);
    ink = vec3f(0.58, 0.41, 0.24);
    gloss = vec3f(1.00, 0.68, 0.38);
  }
  let print = wallpaper_base(uv + vec2f(seed * 0.11, 0.0), px, seed, page, ink, gloss, 1.0);
  let surface = fbm(uv.x * 3.0 + seed, uv.y * 1.8 + seed * 0.7, 4.0) * 0.5 + 0.5;
  let edge = 1.0 - smoothstep(0.0, 0.045, abs(length(uv - vec2f(0.5, 0.5)) - 0.44));
  var col = mix(page, print, 0.7);
  col = mix(col, vec3f(0.98, 0.98, 0.95), edge * 0.3 * (0.3 + surface));
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 1.5, seed + 9.0, 0.972);
  col = col - vec3f(0.02, 0.02, 0.02) * speckle(px, 3.0, seed + 15.0, 0.95);
  return sat3(col);
}
