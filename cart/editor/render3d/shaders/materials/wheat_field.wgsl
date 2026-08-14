// @material wheat_field
// @slug wheat-field
// @name Wheat Field
// @board environment
// @variant-labels Green Ripening, High Gold, Cut Stubble
// @kind surface
// @tags environment, wheat, farm
// @author fable-botanic
fn wheat_field(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base_lo = vec3f(0.34, 0.30, 0.10);
  var base_hi = vec3f(0.72, 0.58, 0.22);
  var stalk_c = vec3f(0.86, 0.72, 0.32);
  var head_c = vec3f(0.92, 0.82, 0.48);
  var stubble = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    base_lo = vec3f(0.16, 0.24, 0.08);
    base_hi = vec3f(0.42, 0.52, 0.16);
    stalk_c = vec3f(0.58, 0.64, 0.26);
    head_c = vec3f(0.74, 0.76, 0.40);
  } else if (variant >= 1.5) {
    base_lo = vec3f(0.30, 0.22, 0.12);
    base_hi = vec3f(0.55, 0.44, 0.24);
    stalk_c = vec3f(0.78, 0.66, 0.36);
    head_c = vec3f(0.66, 0.52, 0.28);
    stubble = 1.0;
  }
  let clump = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5;
  var col = mix(base_lo, base_hi, clump);
  let wind = snoise(uv.x * 2.0 + U.time * 0.25 + seed, uv.y * 2.0) * 0.04;
  let stalkw = line_near(sin((uv.x + wind * (1.0 - stubble)) * 112.0 + uv.y * 5.0), 0.20);
  col = mix(col, stalk_c, stalkw * (0.75 - stubble * 0.35));
  let cutband = line_near(sin(uv.y * 22.0 + seed), 0.25) * stubble;
  col = mix(col, vec3f(0.36, 0.26, 0.16), cutband * 0.7);
  let heads = speckle(px, 4.0, seed + 2.0, 0.90) * (1.0 - stubble * 0.8);
  col = mix(col, head_c, heads * (0.4 + clump * 0.5));
  let awn = line_near(sin((uv.x * 0.7 + uv.y) * 150.0 + seed), 0.14) * (1.0 - stubble);
  col = col + vec3f(0.08, 0.06, 0.02) * awn * clump;
  let shadowpass = fbm(uv.x * 2.2 + seed * 2.4, uv.y * 2.2, 3.0) * 0.5 + 0.5;
  col = col * (0.82 + shadowpass * 0.30);
  return sat3(col);
}
