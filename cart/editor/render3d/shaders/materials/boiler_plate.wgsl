// @material boiler_plate
// @slug boiler-plate
// @name Boiler Plate
// @board metal_yard
// @variant-labels Coal Soot, Verdigris Age, Firebox Warm
// @kind surface
// @tags metal_yard, boiler, rivets, soot
// @author fable-machine_yard
fn boiler_plate(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ironLo = vec3f(0.13, 0.12, 0.12);
  var ironHi = vec3f(0.28, 0.27, 0.26);
  var seamGlow = vec3f(0.28, 0.27, 0.26);
  var glowAmt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    ironLo = vec3f(0.14, 0.18, 0.16);
    ironHi = vec3f(0.30, 0.36, 0.31);
  } else if (variant >= 1.5) {
    ironLo = vec3f(0.16, 0.12, 0.10);
    ironHi = vec3f(0.32, 0.26, 0.22);
    seamGlow = vec3f(0.92, 0.42, 0.10);
    glowAmt = 1.0;
  }
  var col = mix(ironLo, ironHi, fbm(uv.x * 9.0 + seed * 0.3, uv.y * 9.0, 4.0) * 0.5 + 0.5);
  let cols = 3.0;
  let sx = fract(uv.x * cols + fract(seed * 0.271));
  let seam = 1.0 - smoothstep(0.018, 0.04, min(sx, 1.0 - sx));
  col = mix(col, ironLo * 0.5, seam * 0.9);
  col = col + seamGlow * seam * glowAmt * 0.6;
  let bandY = fract(uv.y * 2.0);
  let lap = 1.0 - smoothstep(0.02, 0.05, min(bandY, 1.0 - bandY));
  col = mix(col, ironHi * 1.15, lap * 0.5);
  let rn = 8.0;
  let rcx = (floor(uv.x * cols) + 0.5 + (fract(uv.x * cols) - 0.5)) / cols;
  let rvy = (floor(uv.y * rn) + 0.5) / rn;
  let edge = (floor(uv.x * cols) + select(0.08, 0.92, fract(uv.x * cols) > 0.5)) / cols;
  let dr = length((uv - vec2f(edge, rvy)) * vec2f(1.0, 1.0));
  let riv = 1.0 - smoothstep(0.020, 0.030, dr);
  col = mix(col, ironHi * 1.3, riv);
  col = mix(col, ironLo * 0.6, 1.0 - smoothstep(0.008, 0.016, dr));
  let soot = smoothstep(0.45, 0.9, fbm(uv.x * 4.0 + seed, uv.y * 4.0, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.05, 0.05, 0.05), soot * 0.55);
  col = mix(col, vec3f(0.06, 0.05, 0.05), smoothstep(0.5, 0.0, uv.y) * 0.4);
  col = col + vec3f(0.18, 0.18, 0.17) * speckle(px, 2.0, seed, 0.99) * 0.5;
  return sat3(col);
}
