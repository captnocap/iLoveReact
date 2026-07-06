// @material aurora_fracture
// @slug aurora-fracture
// @name Aurora Fracture
// @board neon_rot
// @variant-labels Thin Rifts, Electric Lace, Void Bleed
// @kind surface
// @tags neon_rot, aurora, neon, fracture
// @author editor
fn aurora_fracture(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.05, 0.06, 0.14);
  var glow = vec3f(0.25, 0.92, 0.78);
  var bleed = vec3f(0.98, 0.33, 0.52);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.06, 0.05, 0.12);
    glow = vec3f(0.52, 0.30, 0.98);
    bleed = vec3f(0.98, 0.46, 0.93);
  } else if (variant >= 1.5) {
    base = vec3f(0.03, 0.08, 0.09);
    glow = vec3f(0.18, 0.62, 1.00);
    bleed = vec3f(0.97, 0.95, 0.52);
  }
  let rime = fbm(uv.x * 5.0 + seed, uv.y * 5.2 + seed * 0.3, 4.0) * 0.5 + 0.5;
  let fracture = 1.0 - smoothstep(0.20, 0.55, abs(sin(uv.y * 16.0 + uv.x * 3.5 + seed) * 0.5 + 0.5));
  var col = mix(base, glow, rime * 0.65);
  let veins = 1.0 - smoothstep(0.035, 0.060, abs(fract(uv.x * 32.0 + seed * 0.2 + uv.y * 7.0) - 0.5));
  col = mix(col, bleed, veins * fracture * 0.5);
  let noiseFleck = speckle(px, 2.0, seed + 3.0, 0.96) * 0.22;
  col = col + vec3f(0.02, 0.02, 0.02) * noiseFleck;
  col = col - vec3f(0.04, 0.04, 0.03) * speckle(px, 3.1, seed + 7.0, 0.93);
  return sat3(col);
}
