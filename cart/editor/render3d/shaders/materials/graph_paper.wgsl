// @material graph_paper
// @slug graph-paper
// @name Graph Paper
// @board wallpapers
// @variant-labels Blue Quad, Engineer Green, Worn Homework
// @kind surface
// @tags wallpapers, graph, grid, pencil
// @author fable-paper_print
fn graph_paper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.94, 0.93, 0.89);
  var gridc = vec3f(0.55, 0.68, 0.86);
  var pencil = vec3f(0.28, 0.28, 0.32);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.88, 0.92, 0.85); gridc = vec3f(0.42, 0.66, 0.46); pencil = vec3f(0.22, 0.24, 0.26); }
  else if (variant >= 1.5) { paper = vec3f(0.88, 0.84, 0.74); gridc = vec3f(0.62, 0.62, 0.72); pencil = vec3f(0.34, 0.30, 0.28); }
  var col = paper * (0.96 + 0.04 * (fbm(uv.x * 40.0, uv.y * 40.0 + seed, 2.0) + 0.5));
  let fine = max(line_near(fract(uv.x * 32.0) - 0.5, 0.045), line_near(fract(uv.y * 32.0) - 0.5, 0.045));
  let major = max(line_near(fract(uv.x * 8.0) - 0.5, 0.018), line_near(fract(uv.y * 8.0) - 0.5, 0.018));
  col = mix(col, gridc, fine * 0.28);
  col = mix(col, gridc, major * 0.55);
  let ph = seed * 0.13;
  let curve = 0.55 + 0.22 * sin(uv.x * 7.0 + ph) + 0.08 * sin(uv.x * 17.0 + ph * 2.0);
  let trace = line_near(uv.y - curve, 0.014);
  col = mix(col, pencil, trace * 0.85);
  let curve2 = 0.42 - 0.18 * (uv.x - 0.5) + 0.05 * sin(uv.x * 11.0 + ph);
  let trace2 = line_near(uv.y - curve2, 0.012);
  col = mix(col, pencil, trace2 * 0.6);
  let pxj = floor(uv.x * 8.0) / 8.0;
  let pt = dot_mark(uv, vec2f(pxj + 0.0625, 0.55 + 0.22 * sin((pxj + 0.0625) * 7.0 + ph)), 0.012);
  col = mix(col, pencil, pt * 0.9);
  let smudge = blotch(uv, vec2f(0.3 + rand(vec2f(seed, 8.0)) * 0.4, 0.65), 0.10, vec2f(1.4, 1.4), seed) * 0.10;
  col = mix(col, pencil, smudge);
  if (variant >= 1.5) {
    let crease = line_near(uv.x - 0.5, 0.02) * 0.5 + line_near(uv.y - 0.5, 0.02) * 0.35;
    col = col - vec3f(crease * 0.10);
    col = col - vec3f(speckle(px, 3.0, seed + 3.0, 0.99) * 0.15);
  }
  return sat3(col);
}
