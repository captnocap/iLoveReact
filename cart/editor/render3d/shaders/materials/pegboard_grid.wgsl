// @material pegboard_grid
// @slug pegboard-grid
// @name Pegboard Grid
// @board wall_props
// @variant-labels Open Grid, Dense Grid, Broken Grid
// @kind surface
// @tags wall_props, grid, metal, peg
// @author editor
fn pegboard_grid(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var panel = vec3f(0.64, 0.67, 0.71);
  var peg = vec3f(0.25, 0.28, 0.32);
  var tarnish = vec3f(0.18, 0.18, 0.17);
  if (variant > 0.5 && variant < 1.5) {
    panel = vec3f(0.56, 0.58, 0.60);
    peg = vec3f(0.29, 0.32, 0.35);
    tarnish = vec3f(0.13, 0.13, 0.12);
  } else if (variant >= 1.5) {
    panel = vec3f(0.72, 0.73, 0.72);
    peg = vec3f(0.50, 0.48, 0.46);
    tarnish = vec3f(0.22, 0.19, 0.18);
  }
  let u = uv.x * 8.0 + sin(uv.y * 24.0 + seed) * 0.07;
  let v = uv.y * 9.0 + cos(uv.x * 18.0 - seed) * 0.06;
  let gx = 1.0 - smoothstep(0.01, 0.045, abs(fract(u) - 0.5));
  let gy = 1.0 - smoothstep(0.01, 0.045, abs(fract(v) - 0.5));
  let grid = max(gx, gy);
  var col = mix(panel, peg, grid * 0.6);
  let hole = 1.0 - smoothstep(0.10, 0.18, line_near(fract(u) - 0.5, 0.36));
  col = mix(col, tarnish, hole * 0.2);
  col = col - vec3f(0.06, 0.06, 0.06) * crack_field(uv * 2.0, seed + 3.0, 7.0) * 0.5;
  col = col + vec3f(0.06, 0.05, 0.05) * speckle(px, 2.1, seed + 4.0, 0.97);
  return sat3(col);
}

