// @material frozen_silt
// @slug frozen-silt
// @name Frozen Silt
// @board environment
// @variant-labels Thin Ice, Mud Freeze, Rime Skin
// @kind surface
// @tags environment, silt, frost, river
// @author editor
fn frozen_silt(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.38, 0.33, 0.28);
  var ice = vec3f(0.78, 0.86, 0.92);
  var grain = vec3f(0.24, 0.21, 0.18);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.30, 0.26, 0.24);
    ice = vec3f(0.83, 0.87, 0.93);
    grain = vec3f(0.29, 0.24, 0.20);
  } else if (variant >= 1.5) {
    base = vec3f(0.55, 0.60, 0.56);
    ice = vec3f(0.97, 0.98, 1.00);
    grain = vec3f(0.40, 0.40, 0.35);
  }
  let frost_field = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 4.0) * 0.5 + 0.5;
  let grain_mask = 1.0 - smoothstep(0.20, 0.34, frost_field);
  var col = mix(base, grain, grain_mask);
  col = mix(col, ice, line_near(uv.x - 0.50 + uv.y * 0.12, 0.014));
  let cracks = crack_field(uv + vec2f(seed * 0.07, seed * 0.03), seed + 3.0, 24.0);
  col = mix(col, vec3f(0.75, 0.83, 0.88), cracks * 0.58);
  let glaze = smoothstep(0.50, 0.95, uv.y) * smoothstep(0.45, 0.12, abs(uv.x - 0.5));
  col = mix(col, vec3f(0.90, 0.94, 0.98), glaze * 0.25);
  col = col + vec3f(0.06, 0.07, 0.08) * speckle(px, 1.8, seed + 4.0, 0.965);
  return sat3(col);
}

