// @material bingo_card
// @slug bingo-card
// @name Bingo Card
// @board wallpapers
// @variant-labels Red Dauber, Rainbow Night, Paper Hall
// @kind composition
// @tags wallpapers, bingo, card, dauber
// @author fable-paper_print
fn bingo_card(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.93, 0.91, 0.85);
  var inkc = vec3f(0.20, 0.20, 0.26);
  var headc = vec3f(0.74, 0.26, 0.24);
  var daub = vec3f(0.82, 0.30, 0.30);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.88, 0.90, 0.92); headc = vec3f(0.26, 0.30, 0.56); daub = vec3f(0.36, 0.66, 0.42); }
  else if (variant >= 1.5) { paper = vec3f(0.89, 0.85, 0.72); headc = vec3f(0.30, 0.44, 0.36); daub = vec3f(0.46, 0.34, 0.62); }
  var col = paper * (0.96 + 0.04 * (fbm(uv.x * 22.0, uv.y * 22.0 + seed, 2.0) + 0.5));
  let gm = rect_mask(uv, 0.10, 0.90, 0.22, 0.92, 0.005);
  let hm = rect_mask(uv, 0.10, 0.90, 0.08, 0.20, 0.005);
  col = mix(col, headc, hm * 0.92);
  let hcell = fract((uv.x - 0.10) / 0.80 * 5.0);
  let hsep = line_near(hcell, 0.04) * hm;
  col = mix(col, paper, hsep * 0.7);
  let lglyph = rect_mask(vec2f(hcell, (uv.y - 0.08) / 0.12), 0.30, 0.70, 0.22, 0.78, 0.05) * hm;
  col = mix(col, paper, lglyph * 0.85);
  let gp = (uv - vec2f(0.10, 0.22)) / vec2f(0.80, 0.70);
  let cid = floor(gp * 5.0);
  let lc = fract(gp * 5.0);
  let gridl = max(line_near(lc.x, 0.045), line_near(lc.y, 0.045));
  col = mix(col, inkc, gridl * gm * 0.6);
  let isfree = step(abs(cid.x - 2.0) + abs(cid.y - 2.0), 0.1);
  col = mix(col, headc * 0.85, isfree * gm * rect_mask(lc, 0.12, 0.88, 0.12, 0.88, 0.03) * 0.5);
  let numb = rect_mask(lc, 0.32, 0.68, 0.28, 0.72, 0.04) * (1.0 - isfree);
  let numsplit = line_near(lc.x - 0.5, 0.05) * numb;
  col = mix(col, inkc, numb * gm * 0.7);
  col = mix(col, paper, numsplit * gm * 0.5);
  let hit = step(rand(vec2f(cid.x + cid.y * 5.0, seed)), 0.42);
  let dc = vec2f(0.5, 0.5) + vec2f(rand(vec2f(cid.x, seed + 2.0)) - 0.5, rand(vec2f(cid.y, seed + 3.0)) - 0.5) * 0.16;
  var dcol = daub;
  if (variant > 0.5 && variant < 1.5) { dcol = hsv2rgb(rand(vec2f(cid.x + cid.y * 5.0, seed + 4.0)), 0.7, 0.75); }
  let mark2 = smoothstep(0.34, 0.28, length((lc - dc) * vec2f(1.0, 1.05)));
  col = mix(col, dcol, mark2 * hit * gm * 0.55);
  let rim = line_near(length(lc - dc) - 0.32, 0.02) * hit * gm;
  col = mix(col, dcol * 0.8, rim * 0.5);
  col = col - vec3f(speckle(px, 3.0, seed + 5.0, 0.99) * 0.09);
  return sat3(col);
}
