// @material cooling_fins
// @slug cooling-fins
// @name Cooling Fins
// @board metal_yard
// @variant-labels Bare Aluminum, Heat Soaked, Anodized Black
// @kind surface
// @tags metal_yard, heatsink, fins, aluminum
// @author fable-machine_yard
fn cooling_fins(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var finTone = vec3f(0.62, 0.64, 0.66);
  var gapTone = vec3f(0.09, 0.10, 0.11);
  var heatTone = vec3f(0.62, 0.64, 0.66);
  var heatAmt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    finTone = vec3f(0.58, 0.55, 0.52);
    heatTone = vec3f(0.72, 0.42, 0.20);
    heatAmt = 1.0;
  } else if (variant >= 1.5) {
    finTone = vec3f(0.16, 0.17, 0.19);
    gapTone = vec3f(0.03, 0.03, 0.04);
    heatTone = vec3f(0.24, 0.25, 0.28);
    heatAmt = 0.4;
  }
  let n = 26.0;
  let fx = fract(uv.x * n + fract(seed * 0.113));
  let ridge = sin(fx * 3.14159);
  var col = mix(gapTone, finTone * (0.55 + 0.55 * ridge), smoothstep(0.10, 0.30, ridge));
  col = col + vec3f(0.2, 0.2, 0.2) * pow(ridge, 10.0) * 0.6;
  let grain = fbm(uv.x * 8.0, uv.y * 60.0 + seed, 3.0) * 0.5 + 0.5;
  col = col * (0.88 + 0.24 * grain);
  let heat = smoothstep(0.35, 1.0, uv.y) * heatAmt;
  col = mix(col, heatTone * (0.5 + 0.6 * ridge), heat * 0.6);
  let band1 = 1.0 - smoothstep(0.015, 0.03, abs(uv.y - 0.12));
  let band2 = 1.0 - smoothstep(0.015, 0.03, abs(uv.y - 0.88));
  col = mix(col, vec3f(0.34, 0.35, 0.37), max(band1, band2) * 0.8);
  let dust = smoothstep(0.55, 0.9, fbm(uv.x * 6.0 + seed * 0.4, uv.y * 6.0, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.35, 0.31, 0.25), dust * 0.25 * (1.0 - ridge));
  col = col + vec3f(0.25, 0.25, 0.24) * speckle(px, 2.0, seed, 0.993) * 0.4;
  return sat3(col);
}
