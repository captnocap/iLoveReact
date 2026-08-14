// @material chocolate_bar
// @slug chocolate-bar
// @name Chocolate Bar
// @board props
// @variant-labels Milk Classic, Midnight Dark, White Vanilla
// @kind surface
// @tags props, chocolate, candy, sweet
// @author fable-food
fn chocolate_bar(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let guv = vec2f(uv.x * 4.0, uv.y * 5.0);
  let cell = floor(guv);
  let local = fract(guv);
  let ex = min(local.x, 1.0 - local.x);
  let ey = min(local.y, 1.0 - local.y);
  let edge = min(ex, ey);
  let groove = 1.0 - smoothstep(0.03, 0.10, edge);
  let bevel = smoothstep(0.10, 0.26, edge);
  var base = vec3f(0.38, 0.21, 0.10);
  var deep = vec3f(0.16, 0.08, 0.04);
  var sheen = vec3f(0.64, 0.43, 0.24);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.21, 0.11, 0.08);
    deep = vec3f(0.07, 0.03, 0.02);
    sheen = vec3f(0.44, 0.25, 0.17);
  } else if (variant >= 1.5) {
    base = vec3f(0.91, 0.85, 0.68);
    deep = vec3f(0.63, 0.54, 0.38);
    sheen = vec3f(0.98, 0.96, 0.86);
  }
  let tone = rand(cell + vec2f(seed * 0.13, seed * 0.07)) * 0.12;
  var col = base * (0.94 + tone);
  col = mix(col, deep, groove * 0.85);
  let facet = smoothstep(0.0, 0.5, (0.5 - local.x) + (0.5 - local.y)) * bevel;
  col = mix(col, sheen, facet * 0.35);
  let crumb = speckle(px + cell * 7.0, 3.0, seed, 0.965);
  col = mix(col, sheen, crumb * 0.3);
  let swirl = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  col = col * (0.90 + swirl * 0.18);
  return sat3(col);
}
