// @material cockpit_console
// @slug cockpit-console
// @name Cockpit Console
// @board neon_surface
// @variant-labels Night Ops, Daylight Grey, Red Alert
// @kind composition
// @tags neon_surface, cockpit, switches, panel
// @author fable-scifi_hull
fn cockpit_console(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var panel_lo = vec3f(0.08, 0.09, 0.12);
  var panel_hi = vec3f(0.16, 0.17, 0.21);
  var screenc = vec3f(0.15, 0.75, 0.60);
  var lampc = vec3f(0.95, 0.70, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    panel_lo = vec3f(0.38, 0.39, 0.42);
    panel_hi = vec3f(0.55, 0.56, 0.58);
    screenc = vec3f(0.20, 0.45, 0.85);
    lampc = vec3f(0.25, 0.80, 0.35);
  } else if (variant >= 1.5) {
    panel_lo = vec3f(0.11, 0.05, 0.06);
    panel_hi = vec3f(0.20, 0.09, 0.10);
    screenc = vec3f(0.95, 0.30, 0.20);
    lampc = vec3f(1.00, 0.45, 0.15);
  }
  let gN = vec2f(5.0, 4.0);
  let cell = floor(uv * gN);
  let lc = fract(uv * gN);
  let kindr = rand(cell + vec2f(seed * 0.29, 1.0));
  let wear = fbm(uv.x * 10.0 + seed, uv.y * 10.0, 3.0) * 0.5 + 0.5;
  var col = mix(panel_lo, panel_hi, wear);
  let gapm = 1.0 - smoothstep(0.015, 0.05, min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y)));
  if (kindr < 0.40) {
    let sw = rect_mask(lc, 0.38, 0.62, 0.25, 0.75, 0.02);
    col = mix(col, vec3f(0.05, 0.05, 0.06), sw);
    let state = step(0.5, rand(cell + vec2f(seed, 7.0)));
    let knob = rect_mask(lc, 0.42, 0.58, 0.28 + state * 0.24, 0.48 + state * 0.24, 0.02);
    col = mix(col, mix(vec3f(0.70, 0.71, 0.74), lampc, state * 0.5), knob);
    let tick = rect_mask(lc, 0.30, 0.70, 0.80, 0.84, 0.01);
    col = mix(col, vec3f(0.80, 0.80, 0.78), tick * 0.7);
  } else if (kindr < 0.65) {
    let ring = dot_mark(lc, vec2f(0.5, 0.5), 0.26) - dot_mark(lc, vec2f(0.5, 0.5), 0.20);
    col = mix(col, vec3f(0.04, 0.04, 0.05), dot_mark(lc, vec2f(0.5, 0.5), 0.20));
    col = mix(col, vec3f(0.55, 0.56, 0.60), sat(ring));
    let pa = rand(cell + vec2f(seed, 3.0)) * 6.2831853;
    let mark = segment_mark(lc, vec2f(0.5, 0.5), vec2f(0.5, 0.5) + vec2f(cos(pa), sin(pa)) * 0.16, 0.025);
    col = mix(col, lampc, mark);
  } else if (kindr < 0.85) {
    let scr = rect_mask(lc, 0.14, 0.86, 0.18, 0.82, 0.02);
    let plot = snoise(lc.x * 5.0 + cell.x + seed, cell.y * 3.0) * 0.5 + 0.5;
    let traceline = exp(-pow((lc.y - 0.3 - plot * 0.4) * 12.0, 2.0));
    col = mix(col, screenc * 0.12, scr);
    col = mix(col, screenc, scr * traceline * 0.9);
    let scan2 = sin(lc.y * 60.0) * 0.5 + 0.5;
    col = mix(col, col * (0.85 + scan2 * 0.15), scr);
  } else {
    let on = step(0.4, rand(cell + vec2f(seed * 1.7, 9.0)));
    let lamp = dot_mark(lc, vec2f(0.5, 0.42), 0.14);
    col = mix(col, lampc * (0.25 + on), lamp);
    col = col + lampc * lamp * on * 0.6;
    let label = rect_mask(lc, 0.3, 0.7, 0.66, 0.72, 0.01);
    col = mix(col, vec3f(0.75, 0.75, 0.72), label * 0.6);
  }
  col = mix(col, panel_lo * 0.6, gapm * 0.7);
  let scuff = speckle(px, 3.0, seed + 5.0, 0.975);
  col = mix(col, panel_hi * 1.3, scuff * 0.3);
  return sat3(col);
}
