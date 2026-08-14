// @material dusk_tarmac
// @slug dusk-tarmac
// @name Dusk Tarmac
// @board environment
// @variant-labels Lowlight, Sodium Tint, Warm Dusk
// @kind surface
// @tags environment, tarmac, dusk, sheen
// @author editor
fn dusk_tarmac(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var asphalt = vec3f(0.16, 0.17, 0.18);
  var glow = vec3f(0.72, 0.40, 0.22);
  var ash = vec3f(0.06, 0.06, 0.07);
  if (variant > 0.5 && variant < 1.5) {
    asphalt = vec3f(0.20, 0.18, 0.16);
    glow = vec3f(0.95, 0.46, 0.25);
    ash = vec3f(0.22, 0.19, 0.17);
  } else if (variant >= 1.5) {
    asphalt = vec3f(0.14, 0.10, 0.08);
    glow = vec3f(0.90, 0.70, 0.28);
    ash = vec3f(0.04, 0.03, 0.03);
  }
  let patchField = fbm(uv.x * 4.5 + seed, uv.y * 11.0 + seed * 0.3, 5.0) * 0.5 + 0.5;
  let sheen = line_near(sin(uv.x * 28.0 + uv.y * 5.0 + seed), 0.09);
  var col = mix(asphalt, ash, smoothstep(0.12, 0.78, patchField));
  col = mix(col, glow, sheen * (0.22 + variant * 0.12));
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 1.5, seed + 6.0, 0.96);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 2.4, seed + 9.0, 0.94);
  return sat3(col);
}
