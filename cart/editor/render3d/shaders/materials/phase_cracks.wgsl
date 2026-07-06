// @material phase_cracks
// @slug phase-cracks
// @name Phase Cracks
// @board liminal
// @variant-labels Pale Fracture, Shallow Fracture, Deep Fracture
// @kind surface
// @tags liminal, cracks, phase
// @author editor
fn phase_cracks(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.22, 0.23, 0.28);
  var line = vec3f(0.74, 0.82, 0.96);
  var voidc = vec3f(0.04, 0.05, 0.07);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.27, 0.21, 0.30);
    line = vec3f(0.60, 0.62, 0.94);
    voidc = vec3f(0.09, 0.06, 0.08);
  } else if (variant >= 1.5) {
    base = vec3f(0.32, 0.18, 0.36);
    line = vec3f(0.90, 0.70, 0.95);
    voidc = vec3f(0.45, 0.06, 0.14);
  }
  let v = voronoi(uv.x * 11.0 + seed, uv.y * 11.0 - seed);
  let crack = smoothstep(0.15, 0.48, v.x);
  let seam = 1.0 - smoothstep(0.0, 0.045, v.y * 0.35 + sin(uv.x * 16.0 + uv.y * 16.0));
  var col = mix(base, line, crack);
  col = mix(col, voidc, seam * 0.45);
  let haze = fbm(uv.x * 8.0, uv.y * 8.0 + seed * 0.9, 5.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.98, 0.99, 1.0), smoothstep(0.35, 0.66, haze) * 0.18);
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 1.4, seed + 8.0, 0.976);
  return sat3(col);
}

