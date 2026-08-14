// @material lavender_rows
// @slug lavender-rows
// @name Lavender Rows
// @board environment
// @variant-labels Provence Noon, Dusk Haze, Early Season
// @kind composition
// @tags environment, lavender, farm
// @author fable-botanic
fn lavender_rows(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let depth = pow(uv.y, 1.5);
  let wob = snoise(uv.x * 5.0 + seed, uv.y * 5.0) * 0.06;
  let rowp = fract(depth * 9.0 + wob + seed * 0.13);
  let onrow = smoothstep(0.14, 0.30, rowp) * smoothstep(0.86, 0.70, rowp);
  var soil = vec3f(0.34, 0.25, 0.16);
  var stem = vec3f(0.24, 0.32, 0.18);
  var bloom_lo = vec3f(0.36, 0.24, 0.52);
  var bloom_hi = vec3f(0.66, 0.48, 0.86);
  var bloom_amt = 0.85;
  if (variant > 0.5 && variant < 1.5) {
    soil = vec3f(0.26, 0.17, 0.16);
    stem = vec3f(0.16, 0.20, 0.16);
    bloom_lo = vec3f(0.28, 0.15, 0.44);
    bloom_hi = vec3f(0.55, 0.34, 0.72);
    bloom_amt = 0.95;
  } else if (variant >= 1.5) {
    soil = vec3f(0.40, 0.32, 0.20);
    stem = vec3f(0.30, 0.42, 0.20);
    bloom_lo = vec3f(0.42, 0.36, 0.55);
    bloom_hi = vec3f(0.58, 0.52, 0.72);
    bloom_amt = 0.45;
  }
  let tuft = fbm(uv.x * 34.0 + seed, depth * 44.0, 4.0) * 0.5 + 0.5;
  let plant = mix(stem, mix(bloom_lo, bloom_hi, tuft), bloom_amt * smoothstep(0.25, 0.75, tuft));
  var col = mix(soil, plant, onrow);
  let grit = speckle(px, 3.0, seed, 0.90);
  col = mix(col, vec3f(0.55, 0.46, 0.34), grit * (1.0 - onrow) * 0.5);
  let spike = speckle(px, 4.0, seed + 9.0, 0.94) * onrow;
  col = mix(col, bloom_hi * 1.15, spike * bloom_amt);
  if (variant > 0.5 && variant < 1.5) {
    col = col + vec3f(0.18, 0.08, 0.04) * (1.0 - uv.y) * 0.6;
  }
  return sat3(col);
}
