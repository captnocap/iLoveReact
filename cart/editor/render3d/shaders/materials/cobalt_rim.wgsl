// @material cobalt_rim
// @slug cobalt-rim
// @name Cobalt Rim
// @board neon_surface
// @variant-labels Halo Rim, Hard Rim, Soft Rim
// @kind surface
// @tags neon_surface, cobalt, rim, halo
// @author editor
fn cobalt_rim(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var dark = vec3f(0.16, 0.17, 0.21);
  var neon = vec3f(0.30, 0.83, 0.96);
  var glow = vec3f(0.96, 0.20, 0.55);
  if (variant > 0.5 && variant < 1.5) {
    dark = vec3f(0.14, 0.16, 0.21);
    neon = vec3f(0.58, 0.92, 0.99);
    glow = vec3f(0.88, 0.33, 0.74);
  } else if (variant >= 1.5) {
    dark = vec3f(0.10, 0.11, 0.14);
    neon = vec3f(0.40, 0.52, 0.88);
    glow = vec3f(0.99, 0.67, 0.99);
  }
  let ring = 1.0 - smoothstep(0.025, 0.040, abs(length(uv - vec2f(0.5, 0.5)) - 0.45));
  let noise = fbm(uv.x * 8.0 + seed, uv.y * 8.0 + seed * 0.5, 5.0) * 0.5 + 0.5;
  var col = mix(dark, neon, smoothstep(0.38, 0.80, noise));
  col = mix(col, glow, ring * (0.45 + noise * 0.3));
  col = col + vec3f(0.04, 0.04, 0.04) * speckle(px, 1.8, seed + 9.0, 0.975);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 2.6, seed + 14.0, 0.935);
  return sat3(col);
}
