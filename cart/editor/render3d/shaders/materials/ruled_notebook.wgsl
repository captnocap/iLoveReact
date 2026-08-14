// @material ruled_notebook
// @slug ruled-notebook
// @name Ruled Notebook
// @board wallpapers
// @variant-labels College Rule, Doodle Storm, Old Homework
// @kind surface
// @tags wallpapers, notebook, ruled, paper
// @author fable-paper_print
fn ruled_notebook(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.95, 0.94, 0.90);
  var rulec = vec3f(0.60, 0.72, 0.86);
  var marginc = vec3f(0.82, 0.42, 0.44);
  var ink = vec3f(0.20, 0.24, 0.42);
  if (variant > 0.5 && variant < 1.5) { ink = vec3f(0.16, 0.16, 0.20); marginc = vec3f(0.86, 0.36, 0.34); }
  else if (variant >= 1.5) { paper = vec3f(0.89, 0.85, 0.74); rulec = vec3f(0.62, 0.66, 0.70); ink = vec3f(0.30, 0.26, 0.36); }
  var col = paper * (0.96 + 0.04 * (fbm(uv.x * 30.0, uv.y * 30.0 + seed, 2.0) + 0.5));
  let rules = line_near(fract(uv.y * 18.0) - 0.5, 0.035) * step(0.10, uv.y);
  col = mix(col, rulec, rules * 0.55);
  let margin = line_near(uv.x - 0.14, 0.010);
  col = mix(col, marginc, margin * 0.8);
  let row = floor(uv.y * 18.0 - 0.5);
  let wig = sin(uv.x * 60.0 + row * 3.0 + seed) * 0.006;
  let baseline = (row + 0.90) / 18.0 + wig;
  let wordbit = rand(vec2f(row * 7.0 + floor(uv.x * 22.0), seed));
  let writing = line_near(uv.y - baseline, 0.012) * step(wordbit, 0.72) * step(0.17, uv.x) * step(uv.x, 0.93) * step(0.10, uv.y);
  col = mix(col, ink, writing * 0.8);
  var doodleamt = 0.5;
  if (variant > 0.5 && variant < 1.5) { doodleamt = 1.0; }
  let dc = vec2f(0.06 + rand(vec2f(seed, 4.0)) * 0.05, 0.2 + rand(vec2f(seed, 5.0)) * 0.6);
  let star = line_near(length(uv - dc) - 0.030, 0.010) + line_near(length(uv - dc) - 0.048, 0.008);
  col = mix(col, ink, sat(star) * doodleamt);
  let sc = vec2f(0.5 + rand(vec2f(seed, 6.0)) * 0.3, 0.05);
  let scrib = line_near(uv.y - sc.y - 0.02 * sin(uv.x * 90.0 + seed), 0.010) * step(sc.x, uv.x) * step(uv.x, sc.x + 0.22);
  col = mix(col, ink, scrib * doodleamt * 0.9);
  if (variant >= 1.5) {
    col = mix(col, vec3f(0.62, 0.48, 0.30), blotch(uv, vec2f(0.75, 0.25), 0.14, vec2f(1.1, 1.1), seed) * 0.25);
    col = col - vec3f(speckle(px, 3.0, seed + 2.0, 0.99) * 0.12);
  }
  return sat3(col);
}
