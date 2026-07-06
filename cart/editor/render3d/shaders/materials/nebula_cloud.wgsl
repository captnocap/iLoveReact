// @material nebula_cloud
// @slug nebula-cloud
// @name Nebula Cloud
// @board gradients
// @variant-labels Rose Teal, Ember Drift, Emerald Veil
// @kind gradient
// @tags gradients, nebula, space, clouds
// @author fable-sky_space
fn nebula_cloud(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.03, 0.02, 0.09);
  var cloudA = vec3f(0.85, 0.35, 0.62);
  var cloudB = vec3f(0.20, 0.72, 0.70);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.05, 0.02, 0.04); cloudA = vec3f(0.95, 0.52, 0.20); cloudB = vec3f(0.28, 0.42, 0.85);
  } else if (variant >= 1.5) {
    deep = vec3f(0.02, 0.05, 0.05); cloudA = vec3f(0.35, 0.85, 0.55); cloudB = vec3f(0.72, 0.28, 0.80);
  }
  let n1 = fbm(uv.x * 3.0 + seed, uv.y * 3.0 - seed * 0.7, 5.0) + 0.5;
  let n2 = fbm(uv.x * 5.5 - seed * 0.3, uv.y * 5.5 + seed, 4.0) + 0.5;
  var col = deep;
  col = mix(col, cloudA, smoothstep(0.34, 0.86, n1) * 0.85);
  col = mix(col, cloudB, smoothstep(0.46, 0.96, n2) * 0.70);
  let lane = smoothstep(0.56, 0.76, fbm(uv.x * 4.0 + seed * 1.3, uv.y * 4.0 + 7.0, 4.0) + 0.5);
  col = mix(col, deep * 0.55, lane * 0.55);
  let glowCore = exp(-length(uv - vec2f(0.35 + fract(seed * 0.13) * 0.3, 0.55)) * 4.0);
  col = col + cloudA * glowCore * 0.35;
  let starBig = speckle(px, 2.0, seed, 0.986);
  let starSm = speckle(px, 1.0, seed + 3.0, 0.968);
  col = col + vec3f(0.92, 0.92, 0.98) * starBig + vec3f(0.55, 0.55, 0.62) * starSm;
  return sat3(col);
}
