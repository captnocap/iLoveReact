// @material crossword_grid
// @slug crossword-grid
// @name Crossword Grid
// @board wallpapers
// @variant-labels Daily Paper, Book Cream, Neon Puzzle
// @kind composition
// @tags wallpapers, crossword, puzzle, grid
// @author fable-paper_print
fn crossword_grid(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.92, 0.91, 0.87);
  var blk = vec3f(0.12, 0.12, 0.14);
  var inkc = vec3f(0.22, 0.22, 0.26);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.90, 0.85, 0.70); blk = vec3f(0.22, 0.18, 0.14); inkc = vec3f(0.32, 0.26, 0.22); }
  else if (variant >= 1.5) { paper = vec3f(0.12, 0.10, 0.20); blk = vec3f(0.58, 0.20, 0.62); inkc = vec3f(0.36, 0.80, 0.78); }
  var col = paper * (0.97 + 0.03 * (fbm(uv.x * 24.0, uv.y * 24.0 + seed, 2.0) + 0.5));
  let gm = rect_mask(uv, 0.06, 0.70, 0.06, 0.70, 0.004);
  let gp = (uv - vec2f(0.06, 0.06)) / 0.64;
  let n = 11.0;
  let cid = floor(gp * n);
  let lc = fract(gp * n);
  var isblk = step(rand(vec2f(cid.x + cid.y * n, seed)), 0.24);
  let mirror = step(rand(vec2f((n - 1.0 - cid.x) + (n - 1.0 - cid.y) * n, seed)), 0.24);
  isblk = max(isblk, mirror);
  var cellc = paper * 1.03;
  if (variant >= 1.5) { cellc = vec3f(0.18, 0.16, 0.28); }
  col = mix(col, cellc, gm);
  col = mix(col, blk, isblk * gm);
  let gridl = max(line_near(lc.x - 0.0, 0.05), line_near(lc.y - 0.0, 0.05));
  col = mix(col, inkc, gridl * gm * 0.55);
  let numd = rect_mask(lc, 0.08, 0.30, 0.08, 0.26, 0.02) * (1.0 - isblk) * step(rand(vec2f(cid.x * 3.0 + cid.y, seed + 2.0)), 0.4);
  col = mix(col, inkc, numd * gm * 0.7);
  let pen = step(rand(vec2f(cid.x + cid.y * 7.0, seed + 5.0)), 0.35) * (1.0 - isblk);
  let letter = rect_mask(lc, 0.30, 0.72, 0.34, 0.82, 0.03) * pen;
  col = mix(col, inkc, letter * gm * 0.55);
  let border = max(line_near(min(gp.x, 1.0 - gp.x), 0.012), line_near(min(gp.y, 1.0 - gp.y), 0.012)) * gm;
  col = mix(col, inkc, border * 0.8);
  let cluecol = step(0.75, uv.x) * step(0.06, uv.y) * step(uv.y, 0.94);
  let crow = step(fract(uv.y * 40.0), 0.45) * cluecol * step(rand(vec2f(floor(uv.y * 40.0), seed + 3.0)), 0.80) * step(uv.x, 0.96);
  col = mix(col, inkc, crow * 0.55);
  let cluerow = step(fract(uv.x * 40.0), 0.45) * step(0.76, uv.y) * step(uv.y, 0.94) * step(0.06, uv.x) * step(uv.x, 0.70) * step(rand(vec2f(floor(uv.x * 40.0) + floor(uv.y * 12.0) * 40.0, seed + 6.0)), 0.8);
  col = mix(col, inkc, cluerow * 0.5);
  col = col - vec3f(speckle(px, 3.0, seed, 0.992) * 0.08);
  return sat3(col);
}
