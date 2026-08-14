// @material server_rack
// @slug server-rack
// @name Server Rack
// @board neon_surface
// @variant-labels Black Ops Stack, Beige Legacy, Neon Datacenter
// @kind composition
// @tags neon_surface, server, tech, leds
// @author fable-scifi_hull
fn server_rack(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var face_lo = vec3f(0.08, 0.09, 0.11);
  var face_hi = vec3f(0.15, 0.16, 0.19);
  var railc = vec3f(0.20, 0.21, 0.24);
  var ledA = vec3f(0.20, 0.95, 0.35);
  var ledB = vec3f(0.95, 0.60, 0.15);
  if (variant > 0.5 && variant < 1.5) {
    face_lo = vec3f(0.55, 0.52, 0.45);
    face_hi = vec3f(0.70, 0.67, 0.58);
    railc = vec3f(0.40, 0.38, 0.33);
    ledA = vec3f(0.85, 0.20, 0.15);
    ledB = vec3f(0.25, 0.80, 0.30);
  } else if (variant >= 1.5) {
    face_lo = vec3f(0.05, 0.06, 0.10);
    face_hi = vec3f(0.10, 0.11, 0.17);
    railc = vec3f(0.12, 0.14, 0.22);
    ledA = vec3f(0.20, 0.85, 0.95);
    ledB = vec3f(0.90, 0.25, 0.85);
  }
  let unitN = 7.0;
  let urow = floor(uv.y * unitN);
  let ul = fract(uv.y * unitN);
  let ur = rand(vec2f(urow, seed));
  var col = mix(face_lo, face_hi, ur * 0.6 + fbm(uv.x * 5.0 + seed, urow * 3.0, 2.0) * 0.4 + 0.2);
  let gap = 1.0 - smoothstep(0.02, 0.06, min(ul, 1.0 - ul));
  col = mix(col, vec3f(0.02, 0.02, 0.03), gap * 0.9);
  let isvent = step(0.45, ur);
  let ventzone = rect_mask(vec2f(uv.x, ul), 0.12, 0.68, 0.25, 0.75, 0.02);
  let slots = line_near(fract(ul * 5.0) - 0.5, 1.6);
  col = mix(col, vec3f(0.03, 0.03, 0.04), ventzone * slots * isvent * 0.85);
  let holes = dot_mark(vec2f(fract(uv.x * 24.0), fract(ul * 4.0)), vec2f(0.5, 0.5), 0.16) * ventzone * (1.0 - isvent);
  col = mix(col, vec3f(0.04, 0.04, 0.05), holes * 0.8);
  let ledN = 6.0;
  let lx = fract(uv.x * ledN);
  let lid = floor(uv.x * ledN);
  let inled = rect_mask(vec2f(uv.x, ul), 0.72, 0.95, 0.35, 0.65, 0.02);
  let lr = rand(vec2f(lid + urow * 9.0, seed * 2.1));
  let on = step(0.35, lr);
  var lcol = ledA;
  if (lr > 0.7) { lcol = ledB; }
  let ldm = dot_mark(vec2f(lx, ul), vec2f(0.5, 0.5), 0.10);
  col = mix(col, lcol * (0.4 + on * 0.8), ldm * inled);
  col = col + lcol * ldm * inled * on * 0.5;
  let rail = step(uv.x, 0.05) + step(0.95, uv.x);
  col = mix(col, railc, sat(rail));
  let screw = dot_mark(vec2f(fract(uv.x * 20.0), ul), vec2f(0.5, 0.5), 0.14) * sat(rail);
  col = mix(col, vec3f(0.45, 0.46, 0.50), screw * 0.7);
  let scuff = speckle(px, 3.0, seed + 7.0, 0.97);
  col = mix(col, face_hi * 1.3, scuff * 0.25);
  return sat3(col);
}
