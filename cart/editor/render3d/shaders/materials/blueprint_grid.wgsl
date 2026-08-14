// @material blueprint_grid
// @slug blueprint-grid
// @name Blueprint Grid
// @board wallpapers
// @variant-labels Classic Cyan, Midnight Draft, Diazo Sepia
// @kind surface
// @tags wallpapers, blueprint, drafting, grid
// @author fable-paper_print
fn blueprint_grid(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.09, 0.27, 0.48);
  var lc = vec3f(0.80, 0.88, 0.94);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.05, 0.09, 0.20); lc = vec3f(0.44, 0.66, 0.88); }
  else if (variant >= 1.5) { bg = vec3f(0.88, 0.82, 0.68); lc = vec3f(0.38, 0.28, 0.20); }
  var col = bg * (0.92 + 0.08 * (fbm(uv.x * 9.0 + seed, uv.y * 9.0, 3.0) + 0.5));
  let fine = max(line_near(fract(uv.x * 24.0) - 0.5, 0.05), line_near(fract(uv.y * 24.0) - 0.5, 0.05));
  let major = max(line_near(fract(uv.x * 6.0) - 0.5, 0.02), line_near(fract(uv.y * 6.0) - 0.5, 0.02));
  col = mix(col, lc, fine * 0.16);
  col = mix(col, lc, major * 0.40);
  let ox = 0.18 + rand(vec2f(seed, 1.0)) * 0.12;
  let oy = 0.24 + rand(vec2f(seed, 2.0)) * 0.12;
  let x1 = ox + 0.42;
  let y1 = oy + 0.34;
  let plan = max(max(line_near(uv.x - ox, 0.012) , line_near(uv.x - x1, 0.012)) * step(oy, uv.y) * step(uv.y, y1),
                 max(line_near(uv.y - oy, 0.012), line_near(uv.y - y1, 0.012)) * step(ox, uv.x) * step(uv.x, x1));
  col = mix(col, lc, plan * 0.95);
  let cc = vec2f(x1 - 0.10, oy + 0.10);
  let ring = line_near(length(uv - cc) - 0.07, 0.012);
  col = mix(col, lc, ring * 0.9);
  let dim = line_near(uv.y - (y1 + 0.07), 0.008) * step(ox, uv.x) * step(uv.x, x1);
  let tick = max(line_near(uv.x - ox, 0.010), line_near(uv.x - x1, 0.010)) * step(y1 + 0.045, uv.y) * step(uv.y, y1 + 0.095);
  col = mix(col, lc, sat(dim + tick) * 0.8);
  let noteb = step(fract(uv.y * 30.0), 0.4) * step(0.80, uv.y) * step(uv.y, 0.93) * step(0.60, uv.x) * step(uv.x, 0.94) * step(rand(vec2f(floor(uv.y * 30.0), seed)), 0.8);
  col = mix(col, lc, noteb * 0.55);
  col = col + vec3f((fbm(uv.x * 60.0, uv.y * 60.0 + seed, 2.0)) * 0.04);
  return sat3(col);
}
