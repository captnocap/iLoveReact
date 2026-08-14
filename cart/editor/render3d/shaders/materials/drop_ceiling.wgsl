// @material drop_ceiling
// @slug drop-ceiling
// @name Drop Ceiling
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, drop, ceiling
// @author legacy
fn drop_ceiling(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * vec2f(3.0 + variant * 0.5, 4.0);
  let local = fract(grid);
  let seam_mark = max(1.0 - smoothstep(0.018, 0.050, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.018, 0.050, min(local.y, 1.0 - local.y)));
  let fiber = fbm(uv.x * 38.0 + seed, uv.y * 34.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.52, 0.46, 0.38), vec3f(0.86, 0.78, 0.62), fiber);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.42, 0.28, 0.32), vec3f(0.82, 0.62, 0.72), fiber);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.30, 0.38, 0.34), vec3f(0.70, 0.82, 0.70), fiber);
  }
  let water_ring = line_near(length((uv - vec2f(0.34, 0.38)) * vec2f(1.2, 0.8)) - 0.20, 0.028);
  let sag = smoothstep(0.52, 0.90, fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.10, 0.075, 0.045), water_ring * 0.58 + sag * 0.20);
  col = mix(col, vec3f(0.055, 0.050, 0.045), seam_mark * 0.66);
  return neon_grime(uv, px, col, seed + 12.0, variant);
}
