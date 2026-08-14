// @material coffee_crema
// @slug coffee-crema
// @name Coffee Crema
// @board props
// @variant-labels Espresso Pull, Dark Ristretto, Caramel Swirl
// @kind gradient
// @tags props, coffee, espresso, swirl
// @author fable-food
fn coffee_crema(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var crema = vec3f(0.80, 0.56, 0.28);
  var cremaHi = vec3f(0.92, 0.72, 0.42);
  var brew = vec3f(0.24, 0.12, 0.05);
  var tiger = vec3f(0.55, 0.32, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    crema = vec3f(0.62, 0.40, 0.18);
    cremaHi = vec3f(0.76, 0.54, 0.28);
    brew = vec3f(0.14, 0.07, 0.03);
    tiger = vec3f(0.38, 0.20, 0.08);
  } else if (variant >= 1.5) {
    crema = vec3f(0.88, 0.66, 0.36);
    cremaHi = vec3f(0.97, 0.82, 0.52);
    brew = vec3f(0.32, 0.17, 0.07);
    tiger = vec3f(0.68, 0.44, 0.18);
  }
  let rel = uv - vec2f(0.5, 0.5);
  let d = length(rel);
  let ang = atan2(rel.y, rel.x);
  let spiral = sin(ang * 2.0 + d * 26.0 - seed * 0.7 + fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 5.0) * 0.5 + 0.5;
  var col = mix(crema, cremaHi, spiral);
  let tigerBand = fbm(ang * 2.2 + seed, d * 14.0, 3.0) * 0.5 + 0.5;
  col = mix(col, tiger, smoothstep(0.58, 0.82, tigerBand) * 0.6);
  let breakThrough = smoothstep(0.62, 0.9, fbm(uv.x * 7.0 + seed * 1.7, uv.y * 7.0, 4.0) * 0.5 + 0.5);
  col = mix(col, brew, breakThrough * smoothstep(0.15, 0.4, d));
  let bubbles = speckle(px, 2.0, seed + 3.0, 0.94);
  col = mix(col, cremaHi * 1.1, bubbles * 0.55);
  let ringHi = 1.0 - smoothstep(0.0, 0.22, abs(d - 0.42));
  col = mix(col, brew * 0.8, ringHi * 0.35);
  col = col * (1.05 - d * 0.45);
  return sat3(col);
}
