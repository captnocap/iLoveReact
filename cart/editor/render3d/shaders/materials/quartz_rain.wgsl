// @material quartz_rain
// @slug quartz-rain
// @name Quartz Rain
// @board gradients
// @variant-labels Light Rain, Harsh Rain, Glitter Rain
// @kind surface
// @tags gradients, quartz, rain, droplets
// @author editor
fn quartz_rain(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.90, 0.93, 0.95);
  var glow = vec3f(0.58, 0.86, 1.00);
  var rain = vec3f(0.14, 0.20, 0.26);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.95, 0.97, 1.00);
    glow = vec3f(0.80, 0.94, 1.00);
    rain = vec3f(0.23, 0.29, 0.35);
  } else if (variant >= 1.5) {
    base = vec3f(0.75, 0.76, 0.76);
    glow = vec3f(0.98, 0.99, 0.99);
    rain = vec3f(0.56, 0.65, 0.68);
  }
  let drop = 1.0 - smoothstep(0.035, 0.045, abs(fract((uv.y + seed * 0.3) * 56.0) - 0.5));
  let streak = 1.0 - smoothstep(0.01, 0.035, abs(fract((uv.x + seed * 0.17) * 34.0) - 0.5));
  let drift = 0.5 + 0.5 * sin(U.time * 2.0 + uv.x * 12.0);
  var col = mix(base, glow, fbm(uv.x * 4.0 + seed, uv.y * 3.0 + seed * 0.2, 4.0) * 0.5 + 0.5);
  col = mix(col, rain, (drop + streak) * 0.35 * drift);
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 1.6, seed + 4.0, 0.98);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 2.7, seed + 10.0, 0.94);
  return sat3(col);
}
