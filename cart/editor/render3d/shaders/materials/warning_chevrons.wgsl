// @material warning_chevrons
// @slug warning-chevrons
// @name Warning Chevrons
// @board metal_yard
// @variant-labels Fresh Paint, Forklift Worn, Red Zone
// @kind surface
// @tags metal_yard, hazard, stripes, caution
// @author fable-machine_yard
fn warning_chevrons(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var hi = vec3f(0.92, 0.78, 0.12);
  var lo = vec3f(0.10, 0.10, 0.11);
  var wear = 0.25;
  if (variant > 0.5 && variant < 1.5) {
    hi = vec3f(0.70, 0.60, 0.22);
    lo = vec3f(0.16, 0.15, 0.14);
    wear = 0.85;
  } else if (variant >= 1.5) {
    hi = vec3f(0.85, 0.87, 0.85);
    lo = vec3f(0.68, 0.13, 0.12);
    wear = 0.45;
  }
  let diag = fract((uv.x + uv.y) * 4.0 + fract(seed * 0.19));
  let band = smoothstep(0.48, 0.52, diag) * (1.0 - smoothstep(0.98, 1.0, diag));
  var col = mix(lo, hi, band);
  let tonal = fbm(uv.x * 7.0 + seed, uv.y * 7.0, 3.0) * 0.5 + 0.5;
  col = col * (0.85 + 0.3 * tonal);
  let scr = crack_field(uv, seed, 6.0);
  col = mix(col, vec3f(0.45, 0.44, 0.42), scr * wear * 0.7);
  let chip = speckle(px, 5.0, seed + 2.0, 0.955);
  col = mix(col, vec3f(0.33, 0.32, 0.30), chip * wear);
  col = mix(col, vec3f(0.12, 0.11, 0.09), smoothstep(0.55, 1.0, uv.y) * (0.20 + wear * 0.30));
  let scuff = blotch(uv, vec2f(0.5, 0.6), 0.30, vec2f(1.8, 0.6), seed + 5.0);
  col = mix(col, vec3f(0.28, 0.27, 0.25), scuff * wear * 0.5);
  return sat3(col);
}
