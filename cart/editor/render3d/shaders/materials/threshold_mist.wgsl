// @material threshold_mist
// @slug threshold-mist
// @name Threshold Mist
// @board liminal
// @variant-labels Morning Drift, Dense Drift, Electric Drift
// @kind surface
// @tags liminal, mist, haze, threshold
// @author editor
fn threshold_mist(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var dusk = vec3f(0.18, 0.22, 0.28);
  var fog = vec3f(0.58, 0.64, 0.72);
  var core = vec3f(0.08, 0.11, 0.15);
  if (variant > 0.5 && variant < 1.5) {
    dusk = vec3f(0.28, 0.20, 0.28);
    fog = vec3f(0.62, 0.45, 0.62);
    core = vec3f(0.12, 0.08, 0.14);
  } else if (variant >= 1.5) {
    dusk = vec3f(0.14, 0.18, 0.24);
    fog = vec3f(0.96, 0.96, 1.00);
    core = vec3f(0.24, 0.20, 0.16);
  }
  let fogMask = smoothstep(0.48, 0.96, fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 4.0) * 0.5 + 0.5);
  let bands = 1.0 - smoothstep(0.01, 0.06, abs(sin(uv.y * 24.0 + seed + uv.x * 12.0)));
  var col = mix(dusk, fog, fogMask);
  col = mix(col, core, bands * 0.3);
  let veins = crack_field(uv + vec2f(seed * 0.17, 0.0), seed + 6.0, 18.0);
  col = mix(col, vec3f(0.95, 0.90, 0.84), veins * 0.22);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.0, seed + 4.0, 0.97);
  return sat3(col);
}

