// @material glass_sand
// @slug glass-sand
// @name Glass Sand
// @board second_pass
// @variant-labels Clean Abrasion, Salted Abrasion, Opaque Abrasion
// @kind surface
// @tags second_pass, sand, glass, abrasion
// @author editor
fn glass_sand(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var clear = vec3f(0.78, 0.82, 0.86);
  var sand = vec3f(0.52, 0.50, 0.45);
  var grit = vec3f(0.10, 0.09, 0.08);
  if (variant > 0.5 && variant < 1.5) {
    clear = vec3f(0.70, 0.73, 0.77);
    sand = vec3f(0.72, 0.62, 0.54);
    grit = vec3f(0.20, 0.16, 0.12);
  } else if (variant >= 1.5) {
    clear = vec3f(0.54, 0.56, 0.59);
    sand = vec3f(0.46, 0.41, 0.35);
    grit = vec3f(0.33, 0.28, 0.23);
  }
  let rip = 1.0 - smoothstep(0.20, 0.24, abs(fract((uv.x + uv.y * 1.3) * 42.0 + seed) - 0.5));
  let grain = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 5.0) * 0.5 + 0.5;
  var col = mix(clear, sand, smoothstep(0.38, 0.78, grain));
  col = mix(col, grit, rip * 0.52);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 2.0, seed + 5.0, 0.975);
  col = col - vec3f(0.02, 0.02, 0.02) * speckle(px, 3.0, seed + 9.0, 0.95);
  return sat3(col);
}
