// @material cable_tray
// @slug cable-tray
// @name Cable Tray
// @board metal_yard
// @variant-labels Color Coded, All Black, Grease Coated
// @kind surface
// @tags metal_yard, cables, wiring, tray
// @author fable-machine_yard
fn cable_tray(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rows = 8.0;
  let iy = floor(uv.y * rows);
  let fy = fract(uv.y * rows);
  let r = rand(vec2f(iy, seed));
  var cableTone = vec3f(0.15, 0.15, 0.17);
  if (variant < 0.5) {
    if (r > 0.72) { cableTone = vec3f(0.62, 0.20, 0.16); }
    else if (r > 0.44) { cableTone = vec3f(0.16, 0.32, 0.55); }
    else if (r > 0.22) { cableTone = vec3f(0.75, 0.62, 0.20); }
    else { cableTone = vec3f(0.24, 0.25, 0.27); }
  } else if (variant >= 1.5) {
    if (r > 0.55) { cableTone = vec3f(0.30, 0.22, 0.14); }
    else { cableTone = vec3f(0.20, 0.18, 0.15); }
  } else {
    cableTone = vec3f(0.13 + r * 0.06, 0.13 + r * 0.05, 0.15 + r * 0.05);
  }
  let shade = sin(fy * 3.14159);
  var col = cableTone * (0.35 + 0.85 * shade);
  col = col + vec3f(0.20, 0.20, 0.22) * pow(shade, 9.0) * 0.7;
  let sag = sin(uv.x * 6.28318 + r * 9.0 + seed) * 0.02;
  let wob = fbm(uv.x * 20.0 + iy * 7.0 + seed, uv.y * 3.0 + sag * 30.0, 2.0) * 0.5 + 0.5;
  col = col * (0.85 + 0.3 * wob);
  let tiePhase = fract(uv.x * 5.0 + r * 0.9);
  let tie = 1.0 - smoothstep(0.02, 0.045, abs(tiePhase - 0.5));
  col = mix(col, vec3f(0.82, 0.82, 0.78), tie * shade * 0.9);
  let rail1 = 1.0 - smoothstep(0.0, 0.05, uv.y);
  let rail2 = smoothstep(0.95, 1.0, uv.y);
  let railTone = vec3f(0.48, 0.50, 0.52) * (0.7 + 0.4 * (fbm(uv.x * 30.0, seed, 2.0) * 0.5 + 0.5));
  col = mix(col, railTone, max(rail1, rail2));
  if (variant >= 1.5) {
    col = mix(col, vec3f(0.07, 0.06, 0.04), vertical_drips(uv, seed + 4.0, 0.6) * 0.5);
  }
  col = col + vec3f(0.22, 0.22, 0.20) * speckle(px, 2.0, seed, 0.992) * 0.4;
  return sat3(col);
}
