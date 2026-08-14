// @material latte_art
// @slug latte-art
// @name Latte Art
// @board props
// @variant-labels Rosetta Pour, Heart Cup, Mocha Fern
// @kind composition
// @tags props, latte, coffee, cafe
// @author fable-food
fn latte_art(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var saucer = vec3f(0.90, 0.88, 0.84);
  var cupRim = vec3f(0.96, 0.95, 0.93);
  var crema = vec3f(0.74, 0.48, 0.22);
  var milk = vec3f(0.97, 0.93, 0.86);
  if (variant > 0.5 && variant < 1.5) {
    saucer = vec3f(0.84, 0.80, 0.78);
    crema = vec3f(0.68, 0.40, 0.18);
    milk = vec3f(0.98, 0.95, 0.90);
  } else if (variant >= 1.5) {
    saucer = vec3f(0.70, 0.66, 0.62);
    crema = vec3f(0.46, 0.26, 0.12);
    milk = vec3f(0.94, 0.88, 0.78);
  }
  var col = saucer * (0.9 + (fbm(uv.x * 4.0 + seed, uv.y * 4.0, 2.0) * 0.5 + 0.5) * 0.2);
  let rel = uv - vec2f(0.5, 0.5);
  let d = length(rel);
  let cupMask = 1.0 - smoothstep(0.46, 0.48, d);
  let liquidMask = 1.0 - smoothstep(0.385, 0.40, d);
  col = mix(col, cupRim, cupMask);
  col = mix(col, cupRim * 0.82, smoothstep(0.40, 0.44, d) * cupMask * 0.6);
  let swirl = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  var brewCol = crema * (0.9 + swirl * 0.25);
  let lx = rel.x;
  let ly = rel.y;
  let stem = 1.0 - smoothstep(0.008, 0.02, abs(lx + sin(ly * 9.0 + seed * 0.3) * 0.012));
  var leaf = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    let hx = abs(lx);
    let heart = 1.0 - smoothstep(0.10, 0.13, length(vec2f(hx - 0.055, ly + 0.05) * vec2f(1.0, 0.85)));
    let point = 1.0 - smoothstep(0.0, 0.16, ly - 0.02 + hx * 0.9);
    leaf = sat(heart + sat(point - smoothstep(-0.05, 0.02, -ly)) * 0.0);
    leaf = max(leaf, (1.0 - smoothstep(0.11, 0.15, length(vec2f(lx, ly + 0.02) * vec2f(0.8, 1.1)))) * step(ly, 0.12));
  } else {
    let chevron = sin(ly * 34.0 + seed) * 0.5 + 0.5;
    let width2 = 0.16 * (1.0 - smoothstep(-0.3, 0.28, ly)) + 0.02;
    let wing = smoothstep(0.45, 0.75, chevron) * (1.0 - smoothstep(width2 * 0.7, width2, abs(lx)));
    leaf = max(wing, stem);
  }
  brewCol = mix(brewCol, milk, sat(leaf) * 0.95 * smoothstep(0.38, 0.30, d));
  let fleck = speckle(px, 2.0, seed + 6.0, 0.965);
  brewCol = mix(brewCol, crema * 1.25, fleck * 0.4);
  col = mix(col, brewCol, liquidMask);
  return sat3(col);
}
