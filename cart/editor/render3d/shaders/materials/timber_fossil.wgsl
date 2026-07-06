// @material timber_fossil
// @slug timber-fossil
// @name Timber Fossil
// @board wood_brick_stone
// @variant-labels Wet Bark, Dry Bark, Buried Bark
// @kind surface
// @tags wood_brick_stone, timber, fossil, grain
// @author editor
fn timber_fossil(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bark = vec3f(0.41, 0.27, 0.17);
  var fossil = vec3f(0.85, 0.74, 0.62);
  var voidc = vec3f(0.15, 0.10, 0.06);
  if (variant > 0.5 && variant < 1.5) {
    bark = vec3f(0.31, 0.20, 0.13);
    fossil = vec3f(0.76, 0.63, 0.48);
    voidc = vec3f(0.18, 0.12, 0.08);
  } else if (variant >= 1.5) {
    bark = vec3f(0.72, 0.55, 0.30);
    fossil = vec3f(0.51, 0.39, 0.28);
    voidc = vec3f(0.10, 0.06, 0.05);
  }
  let rings = 1.0 - smoothstep(0.20, 0.35, abs(fract((uv.x * 11.0) + uv.y * 0.4) - 0.5));
  let grain = fbm(uv.x * 9.0 + seed, uv.y * 26.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(fossil, bark, grain * 0.55);
  col = mix(col, vec3f(0.12, 0.09, 0.06), rings * 0.4);
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 2.2, seed + 6.0, 0.948);
  col = col - vec3f(0.04, 0.04, 0.04) * crack_field(uv, seed + 2.0, 23.0);
  return sat3(col);
}

