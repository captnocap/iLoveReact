// @material dawn_blush
// @slug dawn-blush
// @name Dawn Blush
// @board gradients
// @variant-labels Rose Quartz, Peach Milk, Lilac Morning
// @kind gradient
// @tags gradients, dawn, sky, soft
// @author fable-sky_space
fn dawn_blush(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var low = vec3f(0.96, 0.78, 0.76);
  var mid = vec3f(0.90, 0.72, 0.82);
  var high = vec3f(0.60, 0.70, 0.90);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.98, 0.82, 0.62); mid = vec3f(0.95, 0.78, 0.72); high = vec3f(0.72, 0.78, 0.90);
  } else if (variant >= 1.5) {
    low = vec3f(0.88, 0.72, 0.85); mid = vec3f(0.70, 0.62, 0.85); high = vec3f(0.45, 0.50, 0.78);
  }
  let t = smoothstep(0.0, 1.0, uv.y);
  var col = mix(mix(low, mid, smoothstep(0.0, 0.5, t)), high, smoothstep(0.42, 1.0, t));
  let wispA = fbm(uv.x * 3.0 + seed, uv.y * 9.0 - seed * 0.3, 4.0) + 0.5;
  col = mix(col, low * 1.06, smoothstep(0.55, 0.85, wispA) * 0.35 * (1.0 - t));
  let wispB = fbm(uv.x * 6.0 - seed * 0.6, uv.y * 14.0 + seed, 4.0) + 0.5;
  col = mix(col, high * 0.92, smoothstep(0.6, 0.9, wispB) * 0.20 * t);
  let mx = 0.2 + fract(seed * 0.37) * 0.6;
  let star = vec2f(mx, 0.78);
  col = col + vec3f(0.99, 0.98, 0.92) * (dot_mark(uv, star, 0.006) + exp(-length(uv - star) * 30.0) * 0.4);
  let horizonGlow = exp(-uv.y * 4.5);
  col = col + low * horizonGlow * 0.18;
  return sat3(col);
}
