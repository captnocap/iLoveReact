// @material motherboard_traces
// @slug motherboard-traces
// @name Motherboard Traces
// @board neon_surface
// @variant-labels Factory Fresh, Overclocked Glow, Burnt Board
// @kind surface
// @tags neon_surface, pcb, chips, dense
// @author fable-scifi_hull
fn motherboard_traces(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var board_lo = vec3f(0.04, 0.13, 0.08);
  var board_hi = vec3f(0.08, 0.20, 0.12);
  var trace = vec3f(0.45, 0.52, 0.38);
  var chipc = vec3f(0.09, 0.09, 0.11);
  var capc = vec3f(0.25, 0.30, 0.60);
  if (variant > 0.5 && variant < 1.5) {
    board_lo = vec3f(0.03, 0.05, 0.12);
    board_hi = vec3f(0.06, 0.10, 0.20);
    trace = vec3f(0.20, 0.85, 0.90);
    chipc = vec3f(0.07, 0.08, 0.12);
    capc = vec3f(0.85, 0.40, 0.15);
  } else if (variant >= 1.5) {
    board_lo = vec3f(0.10, 0.08, 0.05);
    board_hi = vec3f(0.17, 0.13, 0.08);
    trace = vec3f(0.40, 0.32, 0.22);
    chipc = vec3f(0.05, 0.04, 0.04);
    capc = vec3f(0.35, 0.20, 0.12);
  }
  let wash = fbm(uv.x * 8.0 + seed, uv.y * 8.0, 3.0) * 0.5 + 0.5;
  var col = mix(board_lo, board_hi, wash);
  let ty = fract(uv.y * 30.0 + rand(vec2f(floor(uv.x * 10.0), seed)) * 0.4) - 0.5;
  let ty2 = fract(uv.x * 30.0 + rand(vec2f(floor(uv.y * 10.0), seed + 4.0)) * 0.4) - 0.5;
  let rowon = step(rand(vec2f(floor(uv.y * 30.0), seed * 1.3)), 0.55);
  let colon = step(rand(vec2f(floor(uv.x * 30.0), seed * 1.7)), 0.35);
  let tmask = max(line_near(ty, 0.9) * rowon, line_near(ty2, 0.9) * colon);
  col = mix(col, trace, tmask * 0.8);
  let cellN = 5.0;
  let cell = floor(uv * cellN);
  let lc = fract(uv * cellN);
  let cr = rand(cell + vec2f(seed * 0.19, 8.0));
  let ischip = step(0.62, cr) * step(cr, 0.85);
  let body = rect_mask(lc, 0.22, 0.78, 0.25, 0.75, 0.02);
  col = mix(col, chipc, body * ischip);
  let pin = line_near(fract(lc.x * 10.0) - 0.5, 1.2) * (rect_mask(lc, 0.22, 0.78, 0.14, 0.25, 0.02) + rect_mask(lc, 0.22, 0.78, 0.75, 0.86, 0.02)) * ischip;
  col = mix(col, vec3f(0.75, 0.76, 0.72), sat(pin) * 0.9);
  let notch = dot_mark(lc, vec2f(0.32, 0.35), 0.035) * ischip;
  col = mix(col, vec3f(0.55, 0.56, 0.58), notch);
  let iscap = step(0.85, cr);
  let capm = dot_mark(lc, vec2f(0.5, 0.5), 0.14) * iscap;
  col = mix(col, capc, capm);
  col = mix(col, vec3f(0.80, 0.80, 0.78), dot_mark(lc, vec2f(0.46, 0.46), 0.04) * iscap);
  if (variant >= 1.5) {
    let char_m = blotch(uv, vec2f(0.4 + fract(seed * 0.07) * 0.3, 0.5), 0.5, vec2f(1.0, 1.0), seed);
    col = mix(col, vec3f(0.03, 0.02, 0.02), char_m * 0.75);
  }
  return sat3(col);
}
