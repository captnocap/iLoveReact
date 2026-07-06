// @material holo_ink
// @slug holo-ink
// @name Holo Ink
// @board neon_surface
// @variant-labels Blue Film, Green Film, Violet Film
// @kind surface
// @tags neon_surface, holo, ink, neon
// @author editor
fn holo_ink(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.04, 0.03, 0.06);
  var tint_a = vec3f(0.08, 0.60, 0.96);
  var tint_b = vec3f(0.98, 0.20, 0.92);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.02, 0.05, 0.04);
    tint_a = vec3f(0.24, 0.98, 0.37);
    tint_b = vec3f(0.99, 0.92, 0.26);
  } else if (variant >= 1.5) {
    base = vec3f(0.06, 0.02, 0.06);
    tint_a = vec3f(0.92, 0.28, 0.98);
    tint_b = vec3f(0.26, 0.38, 0.98);
  }
  let scan = fbm(uv.x * 5.0 + seed, uv.y * 9.0 + seed * 0.2, 4.0) * 0.5 + 0.5;
  let wave = sin(uv.x * 26.0 + uv.y * 14.0 + seed * 2.0);
  let pulse = mix(tint_a, tint_b, (wave + 1.0) * 0.5);
  let iridescence = mix(base, pulse, smoothstep(0.2, 0.95, scan + 0.18 * sin(seed + uv.x * 4.0)));
  var col = iridescence + vec3f((scan - 0.5) * 0.06);
  col = mix(col, base, line_near(uv.y + 0.12 * sin(uv.x * 20.0), 0.02) * 0.2);
  col = col + vec3f(0.22, 0.24, 0.28) * speckle(px, 2.2, seed + 4.0, 0.966);
  return sat3(col);
}

