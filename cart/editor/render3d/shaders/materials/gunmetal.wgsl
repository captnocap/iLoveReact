// @material gunmetal
// @slug gunmetal
// @name Gunmetal
// @board props
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags props, gunmetal
// @author legacy
fn gunmetal(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let fine = fbm(uv.x * 20.0 + seed, uv.y * 20.0, 4.0) * 0.5 + 0.5;
  let oil = fbm(uv.x * 4.0 - seed, uv.y * 5.0 + seed, 5.0) * 0.5 + 0.5;
  var low = vec3f(0.045, 0.052, 0.060);
  var high = vec3f(0.25, 0.29, 0.31);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.070, 0.075, 0.070);
    high = vec3f(0.34, 0.35, 0.31);
  } else if (variant >= 1.5) {
    low = vec3f(0.10, 0.105, 0.105);
    high = vec3f(0.50, 0.50, 0.45);
  }
  var col = mix(low, high, fine * 0.44 + oil * 0.22);
  let slide_groove = line_near(sin((uv.y + snoise(uv.x * 2.0, seed) * 0.010) * (74.0 + variant * 12.0)), 0.050);
  let machining = line_near(sin(uv.x * (120.0 + variant * 30.0)), 0.070);
  let holster_wear = smoothstep(0.57, 0.93, uv.x) * smoothstep(0.35, 0.82, uv.y);
  let scratch = line_near(snoise(uv.x * 18.0 + seed, uv.y * 28.0 - seed), 0.016);
  col = col + vec3f(0.055, 0.060, 0.055) * slide_groove + vec3f(0.030, 0.032, 0.030) * machining;
  col = mix(col, vec3f(0.58, 0.57, 0.50), holster_wear * speckle(px, 3.0, seed, 0.90) * (0.28 + variant * 0.08));
  col = col + vec3f(0.14, 0.13, 0.11) * scratch - vec3f(speckle(px, 4.0, seed + 4.0, 0.94) * 0.10);
  return sat3(col);
}
