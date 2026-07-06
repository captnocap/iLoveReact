// @material newsprint_columns
// @slug newsprint-columns
// @name Newsprint Columns
// @board wallpapers
// @variant-labels Morning Edition, Classifieds, Tabloid Extra
// @kind composition
// @tags wallpapers, newsprint, paper, ink
// @author fable-paper_print
fn newsprint_columns(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.86, 0.84, 0.78);
  var ink = vec3f(0.16, 0.15, 0.14);
  var accent = vec3f(0.60, 0.16, 0.12);
  var rowden = 46.0;
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.79, 0.75, 0.64); ink = vec3f(0.24, 0.21, 0.17); accent = vec3f(0.15, 0.23, 0.42); rowden = 60.0; }
  else if (variant >= 1.5) { paper = vec3f(0.91, 0.90, 0.87); ink = vec3f(0.09, 0.09, 0.12); accent = vec3f(0.72, 0.52, 0.10); rowden = 36.0; }
  var col = paper * (0.93 + 0.07 * (fbm(uv.x * 34.0, uv.y * 34.0 + seed, 3.0) + 0.5));
  let cx = floor(uv.x * 3.0);
  let lx = fract(uv.x * 3.0);
  let ingut = step(0.07, lx) * step(lx, 0.93);
  let head = step(uv.y, 0.13);
  let hbar = step(fract(uv.y * 15.0), 0.55) * step(0.05, uv.x) * step(uv.x, 0.95) * head * step(0.02, uv.y);
  let row = floor(uv.y * rowden);
  let rl = fract(uv.y * rowden);
  let wordbit = rand(vec2f(row + cx * 37.0, floor(uv.x * 30.0) + seed));
  let body = step(rl, 0.48) * step(wordbit, 0.82) * ingut * step(0.16, uv.y);
  let pcol = floor(rand(vec2f(seed, 3.0)) * 2.99);
  let photo = step(abs(cx - pcol), 0.1) * step(0.30, uv.y) * step(uv.y, 0.56) * ingut;
  let dgrid = length(fract(px / 5.0) - vec2f(0.5, 0.5));
  let shade = fbm(uv.x * 6.0, uv.y * 6.0 + seed * 0.31, 3.0) + 0.5;
  let dots = step(dgrid, shade * 0.55);
  col = mix(col, ink, sat(hbar + body * 0.78));
  col = mix(col, mix(paper, ink, dots), photo);
  let subhead = step(fract((uv.y - 0.20) * rowden * 0.25), 0.4) * step(uv.y, 0.28) * step(0.20, uv.y) * ingut * step(0.5, rand(vec2f(cx, seed + 9.0)));
  col = mix(col, accent, subhead * 0.85);
  let crule = line_near(min(lx, 1.0 - lx) - 0.015, 0.012);
  col = mix(col, ink, crule * 0.35 * step(0.16, uv.y));
  col = col - vec3f(fbm(uv.x * 2.0 + seed, uv.y * 2.0, 2.0) * 0.05 + 0.025);
  return sat3(col);
}
