// @material high_noon
// @slug high-noon
// @name High Noon
// @board gradients
// @variant-labels Bleached Blue, Desert Glare, Humid Milk
// @kind gradient
// @tags gradients, noon, sun, sky
// @author fable-sky_space
fn high_noon(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var zenith = vec3f(0.32, 0.52, 0.88);
  var horizonTone = vec3f(0.82, 0.88, 0.94);
  var sunCol = vec3f(0.99, 0.98, 0.90);
  var hazeAmt = 0.3;
  if (variant > 0.5 && variant < 1.5) {
    zenith = vec3f(0.40, 0.55, 0.80); horizonTone = vec3f(0.92, 0.88, 0.78); sunCol = vec3f(0.99, 0.95, 0.82); hazeAmt = 0.55;
  } else if (variant >= 1.5) {
    zenith = vec3f(0.55, 0.68, 0.85); horizonTone = vec3f(0.90, 0.92, 0.93); sunCol = vec3f(0.98, 0.98, 0.95); hazeAmt = 0.8;
  }
  let t = smoothstep(0.0, 1.0, uv.y);
  var col = mix(horizonTone, zenith, pow(t, 1.4));
  let sunPos = vec2f(0.30 + fract(seed * 0.21) * 0.4, 0.80);
  let sr = length(uv - sunPos);
  col = col + sunCol * (exp(-sr * 55.0) * 1.6 + exp(-sr * 9.0) * 0.30);
  col = mix(col, vec3f(0.99, 0.99, 0.97), smoothstep(0.020, 0.008, sr));
  let haze = fbm(uv.x * 4.0 + seed, uv.y * 6.0 - seed * 0.4, 4.0) + 0.5;
  col = mix(col, horizonTone, smoothstep(0.5, 0.9, haze) * hazeAmt * (1.0 - t) * 0.6);
  let shimmer = fbm(uv.x * 16.0 - seed, uv.y * 3.0, 3.0);
  col = col + vec3f(shimmer * 0.03);
  return sat3(col);
}
