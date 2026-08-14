// @material mirror_drift
// @slug mirror-drift
// @name Mirror Drift
// @board second_pass
// @variant-labels Soft Drift, Warped Drift, Distorted Drift
// @kind surface
// @tags second_pass, mirror, reflection, drift
// @author editor
fn mirror_drift(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var clear = vec3f(0.76, 0.79, 0.82);
  var shadow = vec3f(0.17, 0.20, 0.25);
  var bloom = vec3f(1.00, 1.00, 1.00);
  if (variant > 0.5 && variant < 1.5) {
    clear = vec3f(0.74, 0.80, 0.84);
    shadow = vec3f(0.16, 0.17, 0.21);
    bloom = vec3f(0.68, 0.90, 0.93);
  } else if (variant >= 1.5) {
    clear = vec3f(0.44, 0.52, 0.66);
    shadow = vec3f(0.26, 0.28, 0.28);
    bloom = vec3f(0.20, 0.95, 0.98);
  }
  let ripple = 1.0 - smoothstep(0.00, 0.045, abs(uv.y - (0.5 + sin(uv.x * 20.0 + seed) * 0.06)));
  let drift = fbm(uv.x * 6.0 + seed, uv.y * 8.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(shadow, clear, ripple);
  col = mix(col, bloom, smoothstep(0.46, 0.81, drift) * 0.38);
  col = col * (0.85 + 0.15 * sin(uv.x * 44.0 + uv.y * 13.0 + U.time * 6.0));
  col = col - vec3f(0.05, 0.05, 0.05) * crack_field(uv + vec2f(seed, seed), seed + 3.0, 10.0);
  col = col + vec3f(0.02, 0.02, 0.03) * speckle(px, 1.9, seed + 11.0, 0.98);
  return sat3(col);
}

