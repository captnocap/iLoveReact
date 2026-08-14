// @material frost_ferns
// @slug frost-ferns
// @name Frost Ferns
// @board environment
// @variant-labels Windowpane Dawn, Deep Freeze, Thin Lace
// @kind surface
// @tags environment, frost, crystal
// @author fable-water_weather
fn frost_ferns(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var glass_tone = vec3f(0.07, 0.12, 0.18);
  var frost_tone = vec3f(0.78, 0.88, 0.94);
  var frost_bright = vec3f(0.94, 0.98, 1.0);
  var growth = 0.55;
  if (variant > 0.5 && variant < 1.5) {
    glass_tone = vec3f(0.04, 0.06, 0.10);
    frost_tone = vec3f(0.62, 0.76, 0.88);
    growth = 0.75;
  } else if (variant >= 1.5) {
    glass_tone = vec3f(0.12, 0.14, 0.20);
    frost_tone = vec3f(0.82, 0.88, 0.90);
    growth = 0.35;
  }
  let glow = fbm(uv.x * 3.0 + seed, uv.y * 3.0, 2.0) * 0.5 + 0.5;
  var col = glass_tone * (0.8 + 0.5 * glow);
  let ridge_a = 1.0 - abs(snoise(uv.x * 8.0 + seed, uv.y * 8.0 - seed));
  let ridge_b = 1.0 - abs(snoise(uv.x * 17.0 - seed * 0.5, uv.y * 17.0 + seed));
  let ridge_c = 1.0 - abs(snoise(uv.x * 31.0 + seed * 0.3, uv.y * 29.0));
  let fern = pow(ridge_a, 2.5) * 0.55 + pow(ridge_b, 3.0) * 0.30 + pow(ridge_c, 3.5) * 0.15;
  let edge_dist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let creep = 1.0 - smoothstep(0.0, 0.55, edge_dist / max(growth, 0.01));
  let plume = fern * (0.35 + 0.65 * creep) * (0.6 + 0.4 * (fbm(uv.x * 5.0 - seed, uv.y * 5.0 + seed, 3.0) * 0.5 + 0.5));
  col = mix(col, frost_tone, smoothstep(0.30, 0.62, plume));
  col = mix(col, frost_bright, smoothstep(0.62, 0.85, plume));
  let needle = line_near(sin((uv.x + uv.y) * 90.0 + seed), 0.08) * smoothstep(0.4, 0.7, plume);
  col = mix(col, frost_bright, needle * 0.5);
  let sparkle = speckle(px, 1.8, seed + 4.0, 0.965) * smoothstep(0.3, 0.6, plume);
  col = mix(col, vec3f(1.0, 1.0, 0.98), sparkle * 0.8);
  return sat3(col);
}
