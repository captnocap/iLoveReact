// @material grip_polymer
// @slug grip-polymer
// @name Grip Polymer
// @board props
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags props, grip, polymer
// @author legacy
fn grip_polymer(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var low = vec3f(0.028, 0.030, 0.034);
  var high = vec3f(0.18, 0.19, 0.19);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.080, 0.070, 0.055);
    high = vec3f(0.32, 0.28, 0.20);
  } else if (variant >= 1.5) {
    low = vec3f(0.030, 0.060, 0.055);
    high = vec3f(0.16, 0.24, 0.20);
  }
  let grain = fbm(uv.x * 26.0 + seed, uv.y * 26.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(low, high, grain * 0.54 + 0.10);
  let diag_a = abs(fract((uv.x + uv.y) * (9.0 + variant * 2.0)) - 0.5);
  let diag_b = abs(fract((uv.x - uv.y) * (9.0 + variant * 2.0)) - 0.5);
  let diamond = 1.0 - smoothstep(0.045, 0.082, min(diag_a, diag_b));
  let stipple = speckle(px, 2.6 - variant * 0.25, seed, 0.66 + variant * 0.04);
  let worn_high = speckle(px + vec2f(21.0, 13.0), 4.0, seed, 0.93);
  col = col + vec3f(0.10, 0.10, 0.09) * diamond + vec3f(0.055, 0.055, 0.050) * stipple;
  col = mix(col, vec3f(0.42, 0.41, 0.36), worn_high * smoothstep(1.0, 1.8, variant) * 0.38);
  return sat3(col);
}
