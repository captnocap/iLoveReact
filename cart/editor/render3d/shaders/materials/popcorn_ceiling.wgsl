// @material popcorn_ceiling
// @slug popcorn-ceiling
// @name Popcorn Ceiling
// @board liminal
// @variant-labels Fresh Coat, Leak Ring, Smoker Yellow
// @kind surface
// @tags liminal, ceiling, stucco
// @author fable-interior_home
fn popcorn_ceiling(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.90, 0.89, 0.86);
  var stain_tone = vec3f(0.60, 0.48, 0.30);
  var tint = vec3f(0.90, 0.89, 0.86);
  var stain_amt = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.86, 0.84, 0.79);
    stain_tone = vec3f(0.52, 0.38, 0.20);
    tint = vec3f(0.84, 0.80, 0.70);
    stain_amt = 0.9;
  } else if (variant >= 1.5) {
    base = vec3f(0.82, 0.77, 0.62);
    stain_tone = vec3f(0.48, 0.36, 0.18);
    tint = vec3f(0.76, 0.68, 0.48);
    stain_amt = 0.6;
  }
  let n1 = snoise(uv.x * 34.0 + seed, uv.y * 34.0) * 0.5 + 0.5;
  let n2 = snoise(uv.x * 70.0 - seed, uv.y * 70.0) * 0.5 + 0.5;
  let lump = smoothstep(0.30, 0.75, n1 * 0.6 + n2 * 0.4);
  var col = mix(base * 0.82, base * 1.06, lump);
  col = mix(col, tint, 0.4 * (fbm(uv.x * 3.0, uv.y * 3.0 + seed, 3.0) * 0.5 + 0.5));
  col = mix(col, base * 0.7, speckle(px, 2.0, seed, 0.93) * 0.5);
  let c = vec2f(0.60 + fract(seed * 0.017) * 0.2, 0.40 + fract(seed * 0.031) * 0.2);
  let d = length(uv - c) + snoise(uv.x * 8.0, uv.y * 8.0 + seed) * 0.02;
  let ring = 1.0 - smoothstep(0.0, 0.035, abs(d - 0.22));
  let inner = 1.0 - smoothstep(0.05, 0.22, d);
  col = mix(col, stain_tone, ring * stain_amt);
  col = mix(col, stain_tone * 1.4, inner * stain_amt * 0.35);
  return sat3(col);
}
