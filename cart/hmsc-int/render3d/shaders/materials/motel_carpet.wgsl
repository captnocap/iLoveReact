// @material motel_carpet
// @slug motel-carpet
// @name Motel Carpet
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, motel, carpet
// @author legacy
fn motel_carpet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let pile = fbm(uv.x * 34.0 + seed, uv.y * 34.0 - seed, 5.0) * 0.5 + 0.5;
  let zig_a = line_near(sin((uv.x + uv.y) * (42.0 + variant * 5.0)), 0.16);
  let zig_b = line_near(sin((uv.x - uv.y) * (38.0 + variant * 6.0)), 0.16);
  var base = mix(vec3f(0.10, 0.08, 0.20), vec3f(0.34, 0.12, 0.40), pile);
  if (variant > 0.5 && variant < 1.5) {
    base = mix(vec3f(0.06, 0.21, 0.22), vec3f(0.18, 0.48, 0.44), pile);
  } else if (variant >= 1.5) {
    base = mix(vec3f(0.22, 0.10, 0.06), vec3f(0.72, 0.34, 0.16), pile);
  }
  var col = mix(base, vec3f(0.95, 0.17, 0.55), zig_a * 0.28);
  col = mix(col, vec3f(0.08, 0.88, 0.86), zig_b * 0.20);
  let burn = blotch(uv, vec2f(0.34, 0.52), 0.11, vec2f(1.0, 0.8), seed + 4.0);
  let stain = blotch(uv, vec2f(0.72, 0.70), 0.20, vec2f(0.7, 1.3), seed + 9.0);
  col = mix(col, vec3f(0.018, 0.014, 0.012), burn * 0.62);
  col = mix(col, vec3f(0.13, 0.08, 0.035), stain * 0.45);
  col = mix(col, vec3f(0.70, 0.74, 0.60), speckle(px, 4.5, seed, 0.95) * 0.34);
  return neon_grime(uv, px, col, seed + 2.0, variant);
}
