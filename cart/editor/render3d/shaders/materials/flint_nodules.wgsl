// @material flint_nodules
// @slug flint-nodules
// @name Flint Nodules
// @board wood_brick_stone
// @variant-labels Sparse Field, Dense Pack, Knapped Faces
// @kind surface
// @tags wood_brick_stone, flint, nodules, stone
// @author fable-geology
fn flint_nodules(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var matrix_c = vec3f(0.80, 0.77, 0.70);
  var core = vec3f(0.14, 0.14, 0.17);
  var cortex = vec3f(0.92, 0.90, 0.84);
  var gate_t = 0.62;
  if (variant > 0.5 && variant < 1.5) {
    matrix_c = vec3f(0.76, 0.72, 0.64);
    core = vec3f(0.12, 0.13, 0.16);
    cortex = vec3f(0.90, 0.88, 0.80);
    gate_t = 0.34;
  } else if (variant >= 1.5) {
    matrix_c = vec3f(0.70, 0.68, 0.62);
    core = vec3f(0.18, 0.16, 0.14);
    cortex = vec3f(0.86, 0.84, 0.78);
    gate_t = 0.48;
  }
  let dust = fbm(uv.x * 10.0 + seed * 0.5, uv.y * 10.0 - seed * 0.4, 3.0);
  var col = matrix_c * (0.9 + dust * 0.3);
  col = mix(col, matrix_c * 0.8, speckle(px, 3.0, seed + 1.0, 0.94) * 0.5);
  let vc = voronoi(uv.x * 7.0 + seed * 0.9, uv.y * 7.0 - seed * 0.6);
  let cid = rand(vec2f(vc.y, seed * 0.05));
  let gate = step(gate_t, cid);
  let body = smoothstep(0.30, 0.22, vc.x) * gate;
  let rim = smoothstep(0.34, 0.28, vc.x) * (1.0 - smoothstep(0.28, 0.20, vc.x)) * gate;
  var ncol = core * (0.8 + fract(cid * 7.7) * 0.5);
  if (variant >= 1.5) {
    let facet = floor(fract(cid * 3.1) * 3.0 + smoothstep(0.05, 0.20, vc.x) * 2.0);
    ncol = ncol * (0.7 + facet * 0.28);
    ncol = ncol + vec3f(0.30, 0.32, 0.38) * smoothstep(0.02, 0.0, abs(vc.x - 0.11)) * 0.8;
  }
  col = mix(col, cortex, rim * 0.9);
  col = mix(col, ncol, body);
  col = col + vec3f(0.85, 0.88, 0.94) * speckle(px, 2.0, seed + 5.0, 0.99) * body * 0.9;
  col = mix(col, matrix_c * 0.7, crack_field(uv, seed + 8.0, 2.5) * (1.0 - body) * 0.4);
  return sat3(col);
}
