// @material quartzite_sparkle
// @slug quartzite-sparkle
// @name Sparkling Quartzite
// @board wood_brick_stone
// @variant-labels Sugar White, Rose Blush, Glacier Blue
// @kind surface
// @tags wood_brick_stone, quartzite, sparkle, stone
// @author fable-geology
fn quartzite_sparkle(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.82, 0.81, 0.79);
  var under = vec3f(0.62, 0.61, 0.60);
  var tint = vec3f(0.90, 0.90, 0.88);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.84, 0.72, 0.70);
    under = vec3f(0.64, 0.50, 0.50);
    tint = vec3f(0.92, 0.80, 0.78);
  } else if (variant >= 1.5) {
    base = vec3f(0.72, 0.78, 0.84);
    under = vec3f(0.52, 0.58, 0.66);
    tint = vec3f(0.84, 0.88, 0.93);
  }
  let sugar = fbm(uv.x * 40.0 + seed, uv.y * 40.0 - seed, 4.0);
  var col = mix(under, base, 0.55 + sugar * 0.9);
  let drift = fbm(uv.x * 4.0 + seed * 0.4, uv.y * 4.0, 3.0);
  col = mix(col, tint, smoothstep(0.05, 0.35, drift) * 0.5);
  let seam = sin((uv.y + drift * 0.5) * 9.0 + seed);
  col = mix(col, under, smoothstep(0.85, 0.99, seam) * 0.25);
  col = col + vec3f(0.95, 0.95, 0.98) * speckle(px, 2.0, seed + 2.0, 0.972) * 0.55;
  col = col + vec3f(0.88, 0.90, 0.95) * speckle(px, 3.0, seed + 7.0, 0.988) * 0.8;
  col = mix(col, under * 0.8, crack_field(uv, seed + 4.0, 2.0) * 0.35);
  return sat3(col);
}
