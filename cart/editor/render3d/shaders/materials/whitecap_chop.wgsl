// @material whitecap_chop
// @slug whitecap-chop
// @name Whitecap Chop
// @board environment
// @variant-labels Green Harbor, Blue Water, Overcast Slate
// @kind surface
// @tags environment, chop, waves
// @author fable-water_weather
fn whitecap_chop(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var water_lo = vec3f(0.03, 0.17, 0.16);
  var water_hi = vec3f(0.10, 0.36, 0.32);
  var cap_tone = vec3f(0.92, 0.96, 0.94);
  var cap_gate = 0.62;
  if (variant > 0.5 && variant < 1.5) {
    water_lo = vec3f(0.02, 0.10, 0.26);
    water_hi = vec3f(0.08, 0.28, 0.52);
    cap_gate = 0.68;
  } else if (variant >= 1.5) {
    water_lo = vec3f(0.08, 0.10, 0.12);
    water_hi = vec3f(0.20, 0.24, 0.27);
    cap_tone = vec3f(0.78, 0.82, 0.84);
    cap_gate = 0.55;
  }
  let big = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed * 0.4, 3.0) * 0.5 + 0.5;
  var col = mix(water_lo, water_hi, big);
  let ridge_a = 1.0 - abs(snoise(uv.x * 9.0 + seed, uv.y * 12.0));
  let ridge_b = 1.0 - abs(snoise(uv.x * 15.0 - seed, uv.y * 10.0 + seed));
  let crest = pow(max(ridge_a, ridge_b), 4.0);
  let cap = smoothstep(cap_gate, cap_gate + 0.22, crest * big);
  col = mix(col, cap_tone, cap);
  let spray = speckle(px, 2.5, seed + 6.0, 0.94) * smoothstep(0.4, 0.8, big);
  col = mix(col, cap_tone, spray * 0.6);
  let shadow_side = smoothstep(0.6, 0.2, ridge_a) * (1.0 - cap);
  col = mix(col, water_lo * 0.7, shadow_side * 0.35);
  return sat3(col);
}
