// @material coil_weld
// @slug coil-weld
// @name Coil Weld
// @board metal_yard
// @variant-labels Mild Coil, Heated Coil, Charred Coil
// @kind surface
// @tags metal_yard, coil, weld, metal
// @author editor
fn coil_weld(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.42, 0.44, 0.45);
  var weld = vec3f(0.88, 0.76, 0.44);
  var soot = vec3f(0.14, 0.12, 0.10);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.32, 0.33, 0.35);
    weld = vec3f(0.82, 0.64, 0.54);
    soot = vec3f(0.20, 0.17, 0.16);
  } else if (variant >= 1.5) {
    base = vec3f(0.55, 0.56, 0.58);
    weld = vec3f(0.62, 0.20, 0.08);
    soot = vec3f(0.08, 0.08, 0.09);
  }
  let coil = sin((uv.x * 26.0 + seed * 3.0) * 1.0 + uv.y * 15.0) * 0.5 + 0.5;
  let coilMask = 1.0 - smoothstep(0.44, 0.50, fract(uv.y * 18.0 + coil));
  var col = mix(base, weld, coilMask * 0.78);
  col = mix(col, soot, crack_field(uv + vec2f(seed * 0.02, 0.0), seed + 9.0, 20.0) * 0.4);
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 2.6, seed + 4.0, 0.96);
  col = col - vec3f(0.06, 0.06, 0.07) * line_near(uv.y - 0.35, 0.04);
  return sat3(col);
}

