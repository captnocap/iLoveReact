// @material resin_sheet
// @slug resin-sheet
// @name Resin Sheet
// @board wallpapers
// @variant-labels Gloss Sheet, Glossy Drift, Hardened Film
// @kind surface
// @tags wallpapers, resin, gloss, sheet
// @author editor
fn resin_sheet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.79, 0.72, 0.60);
  var bubble = vec3f(0.96, 0.95, 0.94);
  var dirt = vec3f(0.54, 0.46, 0.38);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.74, 0.84, 0.80);
    bubble = vec3f(0.98, 0.98, 1.00);
    dirt = vec3f(0.44, 0.55, 0.50);
  } else if (variant >= 1.5) {
    base = vec3f(0.70, 0.56, 0.45);
    bubble = vec3f(0.86, 0.73, 0.66);
    dirt = vec3f(0.36, 0.30, 0.28);
  }
  let swells = fbm(uv.x * 8.0 + seed, uv.y * 5.0 + seed * 0.4, 4.0) * 0.5 + 0.5;
  let bubbles = 1.0 - smoothstep(0.35, 0.41, abs(fract(swells * 16.0 + seed) - 0.5));
  var col = mix(base, bubble, smoothstep(0.20, 0.70, swells));
  col = mix(col, dirt, bubbles * 0.38);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 2.0, seed + 7.0, 0.965);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 3.0, seed + 12.0, 0.94);
  return sat3(col);
}
