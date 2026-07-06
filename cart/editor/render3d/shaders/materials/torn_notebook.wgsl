// @material torn_notebook
// @slug torn-notebook
// @name Torn Notebook
// @board wallpapers
// @variant-labels College Tear, Canary Rip, Grid Page
// @kind composition
// @tags wallpapers, notebook, torn, spiral
// @author fable-paper_print
fn torn_notebook(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var desk = vec3f(0.26, 0.22, 0.20);
  var paper = vec3f(0.94, 0.93, 0.89);
  var rulec = vec3f(0.60, 0.70, 0.85);
  var ink = vec3f(0.22, 0.24, 0.36);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.92, 0.85, 0.52); rulec = vec3f(0.46, 0.56, 0.78); desk = vec3f(0.22, 0.24, 0.26); }
  else if (variant >= 1.5) { paper = vec3f(0.91, 0.92, 0.90); rulec = vec3f(0.62, 0.76, 0.66); ink = vec3f(0.20, 0.26, 0.24); }
  var col = desk * (0.9 + 0.1 * (fbm(uv.x * 9.0, uv.y * 9.0 + seed, 3.0) + 0.5));
  let fringe = (fbm(uv.y * 30.0 + seed, seed * 0.5, 3.0)) * 0.05;
  let tearx = 0.13 + fringe + (snoise(uv.y * 90.0 + seed, 2.0) * 0.5 + 0.5) * 0.018;
  let onpaper = smoothstep(tearx - 0.004, tearx + 0.004, uv.x);
  var sheet = paper * (0.96 + 0.04 * (fbm(uv.x * 32.0, uv.y * 32.0 + seed, 2.0) + 0.5));
  if (variant >= 1.5) {
    let grid = max(line_near(fract(uv.x * 22.0) - 0.5, 0.05), line_near(fract(uv.y * 22.0) - 0.5, 0.05));
    sheet = mix(sheet, rulec, grid * 0.35);
  } else {
    let rules = line_near(fract(uv.y * 17.0) - 0.5, 0.035) * step(0.08, uv.y);
    sheet = mix(sheet, rulec, rules * 0.55);
    let marg = line_near(uv.x - 0.24, 0.009);
    sheet = mix(sheet, vec3f(0.84, 0.44, 0.44), marg * 0.7);
  }
  let row = floor(uv.y * 17.0 - 0.5);
  let wordbit = rand(vec2f(row * 9.0 + floor(uv.x * 20.0), seed + 1.0));
  let script = line_near(uv.y - (row + 0.9) / 17.0 - sin(uv.x * 55.0 + row + seed) * 0.005, 0.011) * step(wordbit, 0.66) * step(0.28, uv.x) * step(uv.x, 0.90);
  sheet = mix(sheet, ink, script * 0.75);
  let whitefray = smoothstep(0.035, 0.0, abs(uv.x - tearx)) * (0.5 + 0.5 * (snoise(uv.y * 140.0, seed) * 0.5 + 0.5));
  sheet = mix(sheet, vec3f(0.97, 0.96, 0.94), whitefray * 0.8);
  col = mix(col, sheet, onpaper);
  let holecy = fract(uv.y * 9.0) - 0.5;
  let hole = smoothstep(0.14, 0.10, length(vec2f((uv.x - 0.055) * 9.0, holecy * 1.0) * vec2f(1.0, 1.0)));
  let torn = step(0.72, rand(vec2f(floor(uv.y * 9.0), seed + 3.0)));
  col = mix(col, desk * 0.5, hole * (1.0 - onpaper) * 0.0 + hole * 0.85 * (1.0 - torn) * (1.0 - onpaper));
  let ragged = hole * torn * (1.0 - onpaper);
  col = mix(col, vec3f(0.95, 0.94, 0.90), ragged * 0.55);
  let shadow = smoothstep(0.0, 0.05, uv.x - tearx) * smoothstep(0.10, 0.0, uv.x - tearx);
  col = col - vec3f(shadow * 0.06);
  col = col - vec3f(speckle(px, 3.0, seed, 0.992) * 0.08);
  return sat3(col);
}
