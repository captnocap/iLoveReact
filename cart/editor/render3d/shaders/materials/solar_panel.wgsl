// @material solar_panel
// @slug solar-panel
// @name Solar Panel
// @board neon_surface
// @variant-labels Deep Blue Array, Black Mono, Weathered Farm
// @kind surface
// @tags neon_surface, solar, cells, grid
// @author fable-scifi_hull
fn solar_panel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var cell_lo = vec3f(0.05, 0.10, 0.35);
  var cell_hi = vec3f(0.12, 0.22, 0.55);
  var busc = vec3f(0.75, 0.77, 0.80);
  var framec = vec3f(0.60, 0.62, 0.65);
  if (variant > 0.5 && variant < 1.5) {
    cell_lo = vec3f(0.03, 0.03, 0.05);
    cell_hi = vec3f(0.09, 0.10, 0.13);
    busc = vec3f(0.55, 0.57, 0.60);
    framec = vec3f(0.20, 0.21, 0.23);
  } else if (variant >= 1.5) {
    cell_lo = vec3f(0.10, 0.14, 0.30);
    cell_hi = vec3f(0.22, 0.28, 0.45);
    busc = vec3f(0.62, 0.60, 0.55);
    framec = vec3f(0.48, 0.46, 0.42);
  }
  let gN = vec2f(6.0, 4.0);
  let cell = floor(uv * gN);
  let lc = fract(uv * gN);
  let ctone = rand(cell + vec2f(seed * 0.21, 2.0));
  let facet = fbm(cell.x * 3.0 + seed, cell.y * 3.0, 2.0) * 0.5 + 0.5;
  var col = mix(cell_lo, cell_hi, ctone * 0.5 + facet * 0.3 + lc.x * 0.15 + lc.y * 0.1);
  let subline = max(line_near(fract(lc.x * 8.0) - 0.5, 0.5), line_near(fract(lc.y * 8.0) - 0.5, 0.5));
  col = mix(col, cell_hi * 1.25, subline * 0.35);
  let gap = 1.0 - smoothstep(0.012, 0.035, min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y)));
  col = mix(col, vec3f(0.02, 0.02, 0.03), gap * 0.85);
  let busx = abs(fract(uv.x * 3.0 + 0.5) - 0.5);
  let bus = 1.0 - smoothstep(0.010, 0.022, busx);
  col = mix(col, busc, bus * 0.9);
  let glint = exp(-pow(uv.x * 0.8 + uv.y - 0.9 - (fract(seed * 0.157) - 0.5) * 0.6, 2.0) * 30.0);
  col = col + vec3f(0.80, 0.88, 1.00) * glint * 0.30;
  if (variant >= 1.5) {
    let dust = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5;
    col = mix(col, vec3f(0.45, 0.40, 0.32), smoothstep(0.6, 0.9, dust) * 0.4);
    let deadcell = step(0.92, ctone);
    col = mix(col, vec3f(0.30, 0.22, 0.15), deadcell * (1.0 - gap) * 0.6);
  }
  let border = step(uv.x, 0.02) + step(0.98, uv.x) + step(uv.y, 0.03) + step(0.97, uv.y);
  col = mix(col, framec, sat(border));
  let fleck = speckle(px, 2.0, seed, 0.985);
  col = col + vec3f(0.85, 0.90, 1.00) * fleck * 0.3;
  return sat3(col);
}
