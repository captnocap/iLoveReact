// @material sudoku_page
// @slug sudoku-page
// @name Sudoku Page
// @board wallpapers
// @variant-labels Fresh Puzzle, Half Solved, Ink Expert
// @kind composition
// @tags wallpapers, sudoku, grid, numbers
// @author fable-paper_print
fn sudoku_page(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.93, 0.92, 0.88);
  var inkc = vec3f(0.16, 0.16, 0.20);
  var pencil = vec3f(0.52, 0.52, 0.56);
  var fillrate = 0.30;
  if (variant > 0.5 && variant < 1.5) { fillrate = 0.55; pencil = vec3f(0.44, 0.46, 0.52); }
  else if (variant >= 1.5) { paper = vec3f(0.90, 0.87, 0.78); pencil = vec3f(0.28, 0.34, 0.58); fillrate = 0.75; }
  var col = paper * (0.97 + 0.03 * (fbm(uv.x * 26.0, uv.y * 26.0 + seed, 2.0) + 0.5));
  let gm = rect_mask(uv, 0.14, 0.86, 0.16, 0.88, 0.004);
  let gp = (uv - vec2f(0.14, 0.16)) / 0.72;
  let cid = floor(gp * 9.0);
  let lc = fract(gp * 9.0);
  col = mix(col, paper * 1.04, gm);
  let fine = max(line_near(lc.x, 0.06), line_near(lc.y, 0.06));
  col = mix(col, inkc, fine * gm * 0.30);
  let heavy = max(line_near(fract(gp.x * 3.0), 0.025), line_near(fract(gp.y * 3.0), 0.025));
  let outer = max(line_near(min(gp.x, 1.0 - gp.x), 0.010), line_near(min(gp.y, 1.0 - gp.y), 0.010));
  col = mix(col, inkc, sat(heavy + outer) * gm * 0.85);
  let has = step(rand(vec2f(cid.x + cid.y * 9.0, seed)), fillrate);
  let given = step(rand(vec2f(cid.x * 5.0 + cid.y, seed + 2.0)), 0.45);
  let dg = floor(rand(vec2f(cid.x + cid.y * 13.0, seed + 3.0)) * 3.0);
  var digit = rect_mask(lc, 0.34, 0.66, 0.22, 0.80, 0.04);
  if (dg > 1.5) { digit = max(line_near(lc.x - 0.5, 0.07) * step(0.22, lc.y) * step(lc.y, 0.80), line_near(lc.y - 0.28, 0.06) * step(0.34, lc.x) * step(lc.x, 0.66)); }
  else if (dg > 0.5) { digit = line_near(length(lc - vec2f(0.5, 0.5)) - 0.18, 0.055); }
  col = mix(col, inkc, digit * has * given * gm * 0.85);
  col = mix(col, pencil, digit * has * (1.0 - given) * gm * 0.6);
  let noted = step(rand(vec2f(cid.x * 7.0 + cid.y * 3.0, seed + 6.0)), 0.25) * (1.0 - has);
  let notes = dot_mark(fract(lc * 3.0), vec2f(0.5, 0.5), 0.16) * step(rand(vec2f(floor(lc.x * 3.0) + floor(lc.y * 3.0) * 3.0 + cid.x, seed)), 0.4);
  col = mix(col, pencil, notes * noted * gm * 0.55);
  let title = step(fract(uv.y * 22.0), 0.5) * step(0.06, uv.y) * step(uv.y, 0.11) * step(0.14, uv.x) * step(uv.x, 0.52);
  col = mix(col, inkc, title * 0.75);
  let diffdot = dot_mark(uv, vec2f(0.80 + f32(0) * 0.04, 0.085), 0.014) + dot_mark(uv, vec2f(0.84, 0.085), 0.014);
  col = mix(col, inkc, sat(diffdot) * 0.6);
  col = col - vec3f(speckle(px, 3.0, seed + 4.0, 0.992) * 0.08);
  return sat3(col);
}
