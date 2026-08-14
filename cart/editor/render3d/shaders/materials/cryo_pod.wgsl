// @material cryo_pod
// @slug cryo-pod
// @name Cryo Pod
// @board neon_surface
// @variant-labels Deep Freeze, Thawing Amber, Emergency Wake
// @kind composition
// @tags neon_surface, cryo, glass, frost
// @author fable-scifi_hull
fn cryo_pod(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var glass_lo = vec3f(0.10, 0.20, 0.30);
  var glass_hi = vec3f(0.55, 0.75, 0.88);
  var lampA = vec3f(0.25, 0.95, 0.55);
  var lampB = vec3f(0.20, 0.60, 0.95);
  if (variant > 0.5 && variant < 1.5) {
    glass_lo = vec3f(0.16, 0.14, 0.10);
    glass_hi = vec3f(0.70, 0.62, 0.45);
    lampA = vec3f(0.95, 0.70, 0.20);
    lampB = vec3f(0.90, 0.40, 0.15);
  } else if (variant >= 1.5) {
    glass_lo = vec3f(0.14, 0.08, 0.10);
    glass_hi = vec3f(0.60, 0.42, 0.48);
    lampA = vec3f(1.00, 0.20, 0.20);
    lampB = vec3f(1.00, 0.65, 0.25);
  }
  let frost = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed * 0.5, 4.0) * 0.5 + 0.5;
  let frost2 = fbm(uv.x * 16.0 - seed, uv.y * 16.0, 3.0) * 0.5 + 0.5;
  var col = mix(glass_lo, glass_hi, frost * 0.65 + frost2 * 0.35);
  let fern = 1.0 - smoothstep(0.0, 0.06, abs(snoise(uv.x * 12.0 + seed * 1.7, uv.y * 12.0)));
  col = mix(col, glass_hi * 1.1, fern * frost * 0.5);
  let vig = smoothstep(0.75, 0.25, length(uv - vec2f(0.5, 0.45)));
  col = mix(col * 0.45, col, vig);
  let ghost = exp(-pow(length((uv - vec2f(0.5, 0.42)) * vec2f(2.4, 1.1)), 2.0) * 4.0);
  col = mix(col, glass_lo * 0.7, ghost * 0.4 * (1.0 - frost * 0.5));
  let drip = vertical_drips(uv, seed * 2.3, 0.55);
  col = mix(col, glass_hi * 0.9, drip * 0.3);
  let framem = step(uv.y, 0.06) + step(0.86, uv.y) + step(uv.x, 0.05) + step(0.95, uv.x);
  col = mix(col, vec3f(0.16, 0.18, 0.22), sat(framem));
  let inbar = step(0.90, uv.y) * step(uv.y, 0.97) * step(0.1, uv.x) * step(uv.x, 0.9);
  let lx = fract(uv.x * 8.0);
  let lid = floor(uv.x * 8.0);
  let on = step(0.3, rand(vec2f(lid, seed * 1.9)));
  var lc = lampA;
  if (rand(vec2f(lid, seed + 6.0)) > 0.6) { lc = lampB; }
  let ld = dot_mark(vec2f(lx, fract(uv.y * 14.0)), vec2f(0.5, 0.5), 0.16) * inbar;
  col = mix(col, lc * (0.3 + on), ld);
  col = col + lc * ld * on * 0.6;
  let sparkle = speckle(px, 2.0, seed, 0.985) * frost;
  col = col + vec3f(0.90, 0.95, 1.00) * sparkle * 0.5;
  return sat3(col);
}
