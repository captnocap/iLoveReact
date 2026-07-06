// @material ghost_scanlines
// @slug ghost-scanlines
// @name Ghost Scanlines
// @board second_pass
// @variant-labels Dim Lines, Hacked Lines, Flicker Lines
// @kind surface
// @tags second_pass, scanlines, noise, ghost
// @author editor
fn ghost_scanlines(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.12, 0.10, 0.12);
  var line = vec3f(0.82, 0.96, 0.94);
  var noiseTint = vec3f(0.48, 0.06, 0.18);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.10, 0.10, 0.11);
    line = vec3f(0.88, 0.74, 0.38);
    noiseTint = vec3f(0.22, 0.60, 0.88);
  } else if (variant >= 1.5) {
    base = vec3f(0.18, 0.14, 0.16);
    line = vec3f(0.82, 0.28, 0.26);
    noiseTint = vec3f(0.30, 0.96, 0.58);
  }
  let scan = line_near(fract(uv.y * 120.0), 0.01);
  let drift = fbm(uv.x * 9.0 + seed, uv.y * 4.5 + seed * 0.1, 5.0) * 0.5 + 0.5;
  var col = mix(base, line, scan * (0.2 + 0.1 * drift));
  let bloom = line_near(uv.y - (0.15 + sin(U.time * 4.0 + seed) * 0.04), 0.0018);
  col = mix(col, noiseTint, bloom * 0.4);
  let glitch = 1.0 - smoothstep(0.45, 0.55, abs(drift - 0.5));
  col = mix(col, vec3f(0.04, 0.08, 0.03), glitch * 0.30);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 3.6, seed + 5.0, 0.97);
  return sat3(col);
}

