// @material fern_carbon
// @slug fern-carbon
// @name Fern Carbon
// @board environment
// @variant-labels Damp Fern, Carbon Fern, Spore Fern
// @kind surface
// @tags environment, fern, carbon, pattern
// @author editor
fn fern_carbon(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var moss = vec3f(0.26, 0.29, 0.24);
  var stem = vec3f(0.16, 0.16, 0.17);
  var tip = vec3f(0.62, 0.61, 0.52);
  if (variant > 0.5 && variant < 1.5) {
    moss = vec3f(0.24, 0.28, 0.20);
    stem = vec3f(0.10, 0.11, 0.12);
    tip = vec3f(0.35, 0.35, 0.29);
  } else if (variant >= 1.5) {
    moss = vec3f(0.30, 0.25, 0.24);
    stem = vec3f(0.24, 0.25, 0.22);
    tip = vec3f(0.84, 0.70, 0.52);
  }
  let cover = leaf_cover(uv + vec2f(seed * 0.11, 0.0), 0.46, seed);
  let color = leaf_color(uv * vec2f(2.0, 1.3) + vec2f(seed, seed), seed + 2.0);
  let stemMask = 1.0 - smoothstep(0.05, 0.10, abs(fract((uv.y - uv.x + seed * 0.3) * 28.0) - 0.5));
  var col = mix(moss, stem, stemMask * 0.55);
  col = mix(col, color, cover * 0.4);
  col = mix(col, tip, crack_field(uv, seed + 5.0, 12.0) * 0.3);
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 1.9, seed + 11.0, 0.958);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 2.5, seed + 15.0, 0.94);
  return sat3(col);
}
