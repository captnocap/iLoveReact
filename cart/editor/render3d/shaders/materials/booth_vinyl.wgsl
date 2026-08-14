// @material booth_vinyl
// @slug booth-vinyl
// @name Booth Vinyl
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, booth, vinyl
// @author legacy
fn booth_vinyl(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rib = line_near(sin((uv.x + sin(uv.y * 4.0 + seed) * 0.012) * (45.0 + variant * 11.0)), 0.12);
  let sheen = smoothstep(0.36, 0.96, sin((uv.x * 1.2 + uv.y * 1.6 + seed) * 6.0) * 0.5 + 0.5);
  var col = mix(vec3f(0.34, 0.025, 0.12), vec3f(0.92, 0.08, 0.40), rib * 0.40 + sheen * 0.24);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.025, 0.16, 0.18), vec3f(0.08, 0.78, 0.76), rib * 0.40 + sheen * 0.24);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.24, 0.14, 0.03), vec3f(0.92, 0.62, 0.16), rib * 0.34 + sheen * 0.25);
  }
  let seam = line_near(uv.x - 0.50, 0.014) + line_near(uv.y - 0.50, 0.014);
  let tear = line_near(snoise(uv.x * 11.0 + seed, uv.y * 18.0 - seed), 0.015) * smoothstep(0.46, 0.78, fbm(uv.x * 6.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.03, 0.02, 0.018), sat(seam) * 0.46 + tear * 0.62);
  col = mix(col, vec3f(0.86, 0.82, 0.66), speckle(px, 4.0, seed, 0.94) * 0.26);
  return neon_grime(uv, px, col, seed + 10.0, variant);
}
