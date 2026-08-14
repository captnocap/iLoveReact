// @material biolight_vane
// @slug biolight-vane
// @name Biolight Vane
// @board props
// @variant-labels Soft Pulse, Green Pulse, Blue Pulse
// @kind surface
// @tags props, biolight, cellular, organic
// @author editor
fn biolight_vane(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.15, 0.21, 0.16);
  var bloom = vec3f(0.22, 0.96, 0.42);
  var halo = vec3f(0.12, 0.80, 0.97);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.16, 0.18, 0.14);
    bloom = vec3f(0.30, 0.98, 0.50);
    halo = vec3f(0.10, 0.35, 0.85);
  } else if (variant >= 1.5) {
    base = vec3f(0.08, 0.08, 0.06);
    bloom = vec3f(0.96, 0.70, 0.18);
    halo = vec3f(0.95, 0.42, 0.18);
  }
  let pulse = fbm(uv.x * 6.0 + seed, uv.y * 8.0 - seed * 0.4, 5.0) * 0.5 + 0.5;
  let ring = 1.0 - smoothstep(0.18, 0.25, abs(fract((uv.x + uv.y) * 12.0 + seed) - 0.5));
  let drift = vertical_drips(uv + vec2f(seed * 0.1, seed * 0.2), seed, 1.4 + variant);
  var col = mix(base, bloom, smoothstep(0.24, 0.78, pulse));
  col = mix(col, halo, ring * (0.6 + drift * 0.4));
  col = col + vec3f(0.04, 0.04, 0.04) * speckle(px, 1.9, seed + 4.0, 0.97);
  col = col - vec3f(0.05, 0.06, 0.04) * speckle(px, 2.6, seed + 9.0, 0.94);
  return sat3(col);
}
