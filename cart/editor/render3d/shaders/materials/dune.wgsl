// @material dune
// @slug dune
// @name Dune
// @board second_pass
// @variant-labels Golden, White Gypsum, Red Martian
// @kind surface
// @tags second_pass, dune
// @author legacy
fn dune(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Sine-curve ridge lines with wind ripples, lee-side shadow, and sparse veg.
  let ridge1 = uv.y - (0.25 + sin(uv.x * 2.5 + seed) * 0.12 + sin(uv.x * 4.2 - seed) * 0.06);
  let ridge2 = uv.y - (0.55 + sin(uv.x * 1.8 + seed + 1.3) * 0.10 + sin(uv.x * 3.5 - seed) * 0.05);
  let ridge3 = uv.y - (0.82 + sin(uv.x * 3.0 + seed + 2.7) * 0.08);
  let near_ridge = min(abs(ridge1), min(abs(ridge2), abs(ridge3)));
  let ridge_mask = 1.0 - smoothstep(0.0, 0.06, near_ridge);

  let ripple = line_near(sin((uv.x * 0.3 + uv.y) * 55.0 + seed), 0.08);

  let shadow = smoothstep(0.0, 0.08, ridge1) * (1.0 - smoothstep(0.0, 0.20, ridge1)) * 0.5
             + smoothstep(0.0, 0.08, ridge2) * (1.0 - smoothstep(0.0, 0.20, ridge2)) * 0.5
             + smoothstep(0.0, 0.08, ridge3) * (1.0 - smoothstep(0.0, 0.20, ridge3)) * 0.5;

  var lo = vec3f(0.62, 0.44, 0.18);
  var hi = vec3f(0.90, 0.74, 0.38);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.78, 0.76, 0.72);
    hi = vec3f(0.94, 0.92, 0.88);
  } else if (variant >= 1.5) {
    lo = vec3f(0.42, 0.14, 0.08);
    hi = vec3f(0.78, 0.28, 0.14);
  }
  let tex = fbm(uv.x * 8.0 + seed, uv.y * 8.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(lo, hi, tex);
  col = col + vec3f(0.10, 0.08, 0.04) * ripple;
  col = col - vec3f(0.12, 0.08, 0.04) * shadow;
  col = col + vec3f(0.14, 0.10, 0.04) * ridge_mask;

  let veg = speckle(px + vec2f(11.0, 7.0), 7.0, seed, 0.96) * smoothstep(0.3, 0.7, uv.y);
  col = mix(col, vec3f(0.25, 0.35, 0.10), veg * 0.32);
  return sat3(col);
}
