// @material pixel_paper
// @slug pixel-paper
// @name Pixel Paper
// @board wallpapers
// @variant-labels Cyan Grain, Sepia Grain, Charcoal Grain
// @kind surface
// @tags wallpapers, paper, pixels
// @author editor
fn pixel_paper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.94, 0.93, 0.88);
  var pixel = vec3f(0.24, 0.48, 0.56);
  var ink = vec3f(0.24, 0.23, 0.22);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.94, 0.88, 0.78);
    pixel = vec3f(0.62, 0.44, 0.24);
    ink = vec3f(0.20, 0.24, 0.18);
  } else if (variant >= 1.5) {
    base = vec3f(0.78, 0.74, 0.68);
    pixel = vec3f(0.12, 0.12, 0.12);
    ink = vec3f(0.30, 0.28, 0.27);
  }
  let p = floor(uv * 22.0);
  let jitter = rand(p + vec2f(seed, seed)) * 0.5 + 0.25;
  let blocks = fract(sin(dot(p, vec2f(17.0, 31.0)) * 43758.5453123) * 0.5 + jitter * 0.5);
  let cell = floor(blocks * 4.0);
  let mark = select(0.0, 1.0, cell > 0.5);
  var col = mix(base, pixel, mark);
  col = mix(col, ink, speckle(px, 3.8, seed + 6.0, 0.95) * 0.22);
  col = col - vec3f(0.03, 0.03, 0.03) * line_near(uv.y - 0.5, 0.004);
  col = col + vec3f(0.04, 0.04, 0.04) * speckle(px, 1.9, seed + 12.0, 0.985);
  return sat3(col);
}

