// @material ice_sheet
// @slug ice-sheet
// @name Ice Sheet
// @board liminal
// @variant-labels Arctic Clear, Glacial Blue, Sunset Melt
// @kind surface
// @tags liminal, ice, sheet
// @author legacy
fn ice_sheet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Glacier ice: fracture network, trapped air bubbles, caustic refraction.
  let frac1 = line_near(snoise(uv.x * 3.5 + seed, uv.y * 3.5 - seed), 0.016);
  let frac2 = line_near(snoise(uv.x * 8.0 - seed, uv.y * 6.0 + seed), 0.010);
  let fractures = sat(frac1 + frac2);
  // Bubble inclusions.
  let bubble = speckle(px, 4.2, seed, 0.80);
  var col = mix(vec3f(0.50, 0.66, 0.76), vec3f(0.74, 0.86, 0.92), fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.84, 0.92, 0.96), bubble * 0.22);
  // Caustic refraction — light focused through thickness variations.
  let caustic = line_near(sin(uv.x * 26.0 + uv.y * 16.0 + seed) * sin(uv.x * 16.0 - uv.y * 20.0), 0.09);
  col = col + vec3f(0.10, 0.14, 0.16) * caustic * smoothstep(0.35, 0.85, uv.y);
  // Fracture depth — darkens lines, then adds internal frost glow.
  col = mix(col, vec3f(0.16, 0.30, 0.36), fractures * 0.45);
  col = col + vec3f(0.06, 0.09, 0.11) * fractures;
  // Variant tint: 0 clear arctic, 1 glacial blue, 2 sunset melt (pink).
  if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.35, 0.55, 0.72), 0.18);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.72, 0.55, 0.58), 0.14);
  }
  return sat3(col);
}
