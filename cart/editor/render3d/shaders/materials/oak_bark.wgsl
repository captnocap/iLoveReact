// @material oak_bark
// @slug oak-bark
// @name Oak Bark
// @board environment
// @variant-labels Old Growth, Mossy North Side, Sun Bleached
// @kind surface
// @tags environment, oak, bark
// @author fable-botanic
fn oak_bark(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var crevice = vec3f(0.07, 0.05, 0.04);
  var ridge_lo = vec3f(0.26, 0.19, 0.13);
  var ridge_hi = vec3f(0.46, 0.36, 0.25);
  var moss_amt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    crevice = vec3f(0.05, 0.05, 0.03);
    ridge_lo = vec3f(0.20, 0.16, 0.11);
    ridge_hi = vec3f(0.36, 0.30, 0.20);
    moss_amt = 1.0;
  } else if (variant >= 1.5) {
    crevice = vec3f(0.16, 0.12, 0.09);
    ridge_lo = vec3f(0.42, 0.35, 0.26);
    ridge_hi = vec3f(0.66, 0.58, 0.44);
  }
  let ridge = fbm(uv.x * 14.0 + seed, uv.y * 3.0 + seed * 0.3, 5.0) * 0.5 + 0.5;
  let plate = smoothstep(0.30, 0.58, ridge);
  var col = mix(crevice, mix(ridge_lo, ridge_hi, ridge), plate);
  let toplight = pow(sat(ridge), 3.0);
  col = col + vec3f(0.10, 0.08, 0.05) * toplight;
  let cross = crack_field(uv + vec2f(seed * 0.11, 0.0), seed, 6.0);
  col = mix(col, crevice, cross * 0.8);
  let grainline = line_near(sin(uv.x * 160.0 + snoise(uv.x * 6.0 + seed, uv.y * 2.0) * 3.0), 0.20);
  col = mix(col, col * 0.78, grainline * plate * 0.6);
  let mossm = smoothstep(0.55, 0.80, fbm(uv.x * 8.0 + seed * 1.7, uv.y * 8.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.22, 0.34, 0.13), mossm * moss_amt * (1.0 - plate * 0.5));
  let dust = speckle(px, 2.0, seed + 6.0, 0.95);
  col = mix(col, ridge_hi * 1.2, dust * 0.5);
  return sat3(col);
}
