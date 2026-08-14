// @material abalone_shell
// @slug abalone-shell
// @name Abalone Shell
// @board neon_surface
// @variant-labels Paua Storm, Emerald Swirl, Violet Tide
// @kind surface
// @tags neon_surface, abalone, iridescent, swirl
// @author fable-gems_precious
fn abalone_shell(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sea = vec3f(0.10, 0.42, 0.50);
  var flame = vec3f(0.20, 0.65, 0.45);
  var violet = vec3f(0.42, 0.28, 0.62);
  var crevice = vec3f(0.05, 0.09, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    sea = vec3f(0.08, 0.48, 0.34); flame = vec3f(0.40, 0.78, 0.36); violet = vec3f(0.14, 0.36, 0.55);
  } else if (variant >= 1.5) {
    sea = vec3f(0.30, 0.20, 0.55); flame = vec3f(0.62, 0.32, 0.66); violet = vec3f(0.16, 0.28, 0.60);
    crevice = vec3f(0.08, 0.05, 0.12);
  }
  let wx = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 4.0);
  let wy = fbm(uv.x * 4.0, uv.y * 4.0 + seed * 1.7, 4.0);
  let wp = uv + vec2f(wx, wy) * 0.35;
  let swirl = snoise(wp.x * 6.0 + seed * 0.2, wp.y * 6.0) * 0.5 + 0.5;
  var col = mix(sea, flame, swirl);
  col = mix(col, violet, smoothstep(0.55, 0.85, snoise(wp.x * 3.0, wp.y * 3.0 + seed) * 0.5 + 0.5));
  let shimmer = hsv2rgb(fract(swirl * 1.4 + uv.y * 0.3 + seed * 0.002), 0.55, 1.0);
  col = mix(col, shimmer, 0.20);
  let ridge = line_near(sin((wp.x + wp.y * 0.6) * 30.0), 0.12);
  col = mix(col, col * 1.25, ridge * 0.5);
  col = mix(col, crevice, crack_field(wp, seed + 3.0, 4.0) * 0.45);
  col += vec3f(0.95, 1.0, 0.98) * speckle(px, 2.0, seed, 0.996) * 0.35;
  return sat3(col);
}
