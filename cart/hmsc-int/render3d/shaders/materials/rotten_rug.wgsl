// @material rotten_rug
// @slug rotten-rug
// @name Rotten Rug
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, rotten, rug
// @author legacy
fn rotten_rug(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let border_x = max(1.0 - smoothstep(0.055, 0.12, min(uv.x, 1.0 - uv.x)), 0.0);
  let border_y = max(1.0 - smoothstep(0.055, 0.12, min(uv.y, 1.0 - uv.y)), 0.0);
  let border = sat(border_x + border_y);
  let medallion = line_near(length((uv - vec2f(0.5, 0.5)) * vec2f(1.0, 1.35)) - 0.24, 0.030);
  let thread = fbm(uv.x * 28.0 + seed, uv.y * 24.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.18, 0.035, 0.09), vec3f(0.58, 0.12, 0.23), thread);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.08, 0.18, 0.20), vec3f(0.28, 0.66, 0.62), thread);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.20, 0.14, 0.06), vec3f(0.72, 0.58, 0.24), thread);
  }
  col = mix(col, vec3f(0.96, 0.68, 0.22), border * 0.44);
  col = mix(col, vec3f(0.05, 0.82, 0.90), medallion * 0.32);
  let worn = smoothstep(0.45, 0.76, fbm(uv.x * 8.0 - seed, uv.y * 8.0 + seed, 5.0) * 0.5 + 0.5);
  let fray = (speckle(px, 2.4, seed, 0.78) + line_near(snoise(uv.x * 30.0, uv.y * 10.0 + seed), 0.018)) * smoothstep(0.55, 0.95, border);
  col = mix(col, vec3f(0.20, 0.18, 0.14), worn * 0.45);
  col = mix(col, vec3f(0.82, 0.78, 0.58), fray * 0.28);
  return neon_grime(uv, px, col, seed + 5.0, variant);
}
