// @material peppermint_swirl
// @slug peppermint-swirl
// @name Peppermint Swirl
// @board props
// @variant-labels Red Pinwheel, Spearmint Green, Carnival Mix
// @kind composition
// @tags props, peppermint, candy, swirl
// @author fable-food
fn peppermint_swirl(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var wrapTone = vec3f(0.88, 0.90, 0.93);
  var stripeA = vec3f(0.88, 0.10, 0.16);
  var stripeB = vec3f(0.97, 0.95, 0.93);
  var stripeC = vec3f(0.88, 0.10, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    stripeA = vec3f(0.10, 0.60, 0.36);
    stripeC = vec3f(0.10, 0.60, 0.36);
    wrapTone = vec3f(0.90, 0.94, 0.90);
  } else if (variant >= 1.5) {
    stripeA = vec3f(0.90, 0.16, 0.24);
    stripeC = vec3f(0.98, 0.66, 0.10);
    wrapTone = vec3f(0.92, 0.88, 0.94);
  }
  let wrapNoise = fbm(uv.x * 8.0 + seed, uv.y * 8.0, 3.0) * 0.5 + 0.5;
  var col = wrapTone * (0.86 + wrapNoise * 0.22);
  let rel = uv - vec2f(0.5, 0.5);
  let d = length(rel);
  let ang = atan2(rel.y, rel.x);
  let discMask = 1.0 - smoothstep(0.44, 0.46, d);
  let arms = 10.0;
  let twist = 5.5 + fract(seed * 0.021) * 2.0;
  let ph = fract(ang / 6.28318 * arms * 0.5 + d * twist + seed * 0.03);
  var candy = stripeB;
  let bandA = smoothstep(0.04, 0.10, ph) * (1.0 - smoothstep(0.40, 0.46, ph));
  candy = mix(candy, stripeA, bandA);
  let bandC = smoothstep(0.56, 0.62, ph) * (1.0 - smoothstep(0.78, 0.84, ph));
  candy = mix(candy, stripeC, bandC * 0.9);
  let dome = 1.0 - smoothstep(0.0, 0.46, d);
  candy = candy * (0.80 + dome * 0.28);
  let gleam = dot_mark(rel, vec2f(-0.14, -0.14), 0.09);
  candy = mix(candy, vec3f(1.0, 0.99, 0.97), gleam * 0.55);
  col = mix(col, vec3f(0.30, 0.28, 0.32), smoothstep(0.44, 0.47, d) * (1.0 - smoothstep(0.48, 0.52, d)) * 0.5);
  col = mix(col, candy, discMask);
  let sugarBit = speckle(px, 2.0, seed + 5.0, 0.975);
  col = mix(col, vec3f(0.99, 0.98, 0.97), sugarBit * 0.4);
  return sat3(col);
}
