// @material circuit_board
// @slug circuit-board
// @name Circuit Board
// @board neon_surface
// @variant-labels Solder Green, Midnight Blue, Bare Copper
// @kind surface
// @tags neon_surface, pcb, tech, traces
// @author fable-scifi_hull
fn circuit_board(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var mask_lo = vec3f(0.05, 0.22, 0.10);
  var mask_hi = vec3f(0.10, 0.34, 0.16);
  var trace = vec3f(0.55, 0.62, 0.45);
  var pad = vec3f(0.85, 0.72, 0.35);
  if (variant > 0.5 && variant < 1.5) {
    mask_lo = vec3f(0.03, 0.07, 0.20);
    mask_hi = vec3f(0.07, 0.13, 0.32);
    trace = vec3f(0.50, 0.58, 0.72);
    pad = vec3f(0.80, 0.82, 0.86);
  } else if (variant >= 1.5) {
    mask_lo = vec3f(0.28, 0.14, 0.07);
    mask_hi = vec3f(0.42, 0.22, 0.10);
    trace = vec3f(0.78, 0.45, 0.22);
    pad = vec3f(0.90, 0.62, 0.30);
  }
  let wash = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  var col = mix(mask_lo, mask_hi, wash);
  let rowsN = 16.0;
  let row = floor(uv.y * rowsN);
  let segN = 5.0;
  let segId = floor(uv.x * segN);
  let present = step(rand(vec2f(row, seed * 0.7)), 0.75) * step(rand(vec2f(segId * 7.0 + row, seed)), 0.72);
  let jog = (rand(vec2f(row, seed + 11.0)) - 0.5) * 0.30;
  let ly = fract(uv.y * rowsN + jog * sin(uv.x * 9.0 + seed)) - 0.5;
  let tmask = line_near(ly, 1.4) * present;
  col = mix(col, trace, tmask * 0.9);
  let gcell = floor(uv * vec2f(9.0, 9.0));
  let glocal = fract(uv * vec2f(9.0, 9.0));
  let haspad = step(0.82, rand(gcell + vec2f(seed * 0.3, 2.0)));
  let ring = dot_mark(glocal, vec2f(0.5, 0.5), 0.16) - dot_mark(glocal, vec2f(0.5, 0.5), 0.07);
  col = mix(col, pad, sat(ring) * haspad);
  col = mix(col, vec3f(0.06, 0.06, 0.06), dot_mark(glocal, vec2f(0.5, 0.5), 0.06) * haspad);
  let silk = step(0.93, rand(gcell + vec2f(5.0, seed))) * rect_mask(glocal, 0.2, 0.8, 0.30, 0.42, 0.03);
  col = mix(col, vec3f(0.92, 0.92, 0.90), silk * 0.85);
  let dust = speckle(px, 3.0, seed, 0.975);
  col = mix(col, vec3f(0.70, 0.70, 0.66), dust * 0.3);
  return sat3(col);
}
