// @material golden_hour
// @slug golden-hour
// @name Golden Hour
// @board gradients
// @variant-labels Amber Wash, Copper Field, Rose Gold
// @kind gradient
// @tags gradients, golden, sunset, glow
// @author fable-sky_space
fn golden_hour(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var low = vec3f(0.98, 0.72, 0.30);
  var mid = vec3f(0.92, 0.52, 0.28);
  var high = vec3f(0.45, 0.42, 0.60);
  var cloudLit = vec3f(0.99, 0.85, 0.55);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.95, 0.58, 0.22); mid = vec3f(0.78, 0.38, 0.20); high = vec3f(0.35, 0.30, 0.42); cloudLit = vec3f(0.98, 0.70, 0.38);
  } else if (variant >= 1.5) {
    low = vec3f(0.98, 0.70, 0.55); mid = vec3f(0.92, 0.52, 0.55); high = vec3f(0.52, 0.42, 0.65); cloudLit = vec3f(0.99, 0.82, 0.70);
  }
  let t = smoothstep(0.0, 1.0, uv.y);
  var col = mix(mix(low, mid, smoothstep(0.0, 0.55, t)), high, smoothstep(0.45, 1.0, t));
  let sunX = 0.25 + fract(seed * 0.31) * 0.5;
  let glow = exp(-length((uv - vec2f(sunX, 0.06)) * vec2f(1.0, 2.2)) * 3.2);
  col = col + low * glow * 0.55;
  let streakN = fbm(uv.x * 3.5 + seed, uv.y * 22.0 - seed * 0.5, 4.0) + 0.5;
  let streak = smoothstep(0.55, 0.80, streakN) * smoothstep(0.9, 0.35, t);
  col = mix(col, mid * 0.72, streak * 0.6);
  let litEdge = smoothstep(0.50, 0.58, streakN) * smoothstep(0.66, 0.58, streakN);
  col = col + cloudLit * litEdge * 0.5 * smoothstep(0.9, 0.2, t);
  col = col + vec3f((fbm(uv.x * 9.0 - seed, uv.y * 9.0, 3.0)) * 0.04);
  return sat3(col);
}
