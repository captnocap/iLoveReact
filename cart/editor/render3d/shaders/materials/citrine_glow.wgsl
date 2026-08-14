// @material citrine_glow
// @slug citrine-glow
// @name Citrine Glow
// @board neon_surface
// @variant-labels Pale Lemon, Deep Madeira, Smoky Amber
// @kind gradient
// @tags neon_surface, citrine, glow, warm
// @author fable-gems_precious
fn citrine_glow(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var core = vec3f(1.0, 0.86, 0.42);
  var body = vec3f(0.86, 0.60, 0.16);
  var rim = vec3f(0.46, 0.26, 0.05);
  if (variant > 0.5 && variant < 1.5) {
    core = vec3f(0.98, 0.78, 0.28); body = vec3f(0.72, 0.42, 0.08); rim = vec3f(0.34, 0.16, 0.02);
  } else if (variant >= 1.5) {
    core = vec3f(0.88, 0.70, 0.40); body = vec3f(0.55, 0.38, 0.18); rim = vec3f(0.22, 0.14, 0.08);
  }
  let ctr = vec2f(0.5 + snoise(seed * 0.13, 0.4) * 0.15, 0.45 + snoise(seed * 0.21, 3.1) * 0.15);
  let d = length(uv - ctr);
  let glow = exp(-d * d * 7.0);
  var col = mix(rim, body, smoothstep(0.85, 0.25, d));
  col = mix(col, core, glow);
  let haze = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5;
  col = mix(col * 0.90, col * 1.08, haze);
  let band = line_near(sin((uv.y + haze * 0.15) * 18.0 + seed), 0.10);
  col = mix(col, col * 1.12, band * 0.35);
  let wisp = smoothstep(0.62, 0.85, fbm(uv.x * 14.0, uv.y * 14.0 + seed * 1.3, 4.0) * 0.5 + 0.5);
  col = mix(col, rim * 0.9, wisp * 0.20);
  col += vec3f(1.0, 0.94, 0.70) * speckle(px, 2.0, seed, 0.997) * 0.3;
  return sat3(col);
}
