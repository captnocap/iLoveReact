// @material coral_vault
// @slug coral-vault
// @name Coral Vault
// @board wall_props
// @variant-labels Coral Dust, Deep Coral, Dark Coral
// @kind surface
// @tags wall_props, coral, vault, marine
// @author editor
fn coral_vault(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var coral = vec3f(0.63, 0.33, 0.28);
  var voidc = vec3f(0.16, 0.07, 0.08);
  var gloss = vec3f(0.96, 0.74, 0.63);
  if (variant > 0.5 && variant < 1.5) {
    coral = vec3f(0.80, 0.28, 0.32);
    voidc = vec3f(0.24, 0.12, 0.14);
    gloss = vec3f(0.98, 0.58, 0.72);
  } else if (variant >= 1.5) {
    coral = vec3f(0.45, 0.18, 0.18);
    voidc = vec3f(0.08, 0.04, 0.03);
    gloss = vec3f(0.68, 0.22, 0.15);
  }
  let scale = 1.0 - smoothstep(0.0, 0.025, abs(sin((uv.y * 45.0 + uv.x * 12.0 + seed) * 0.5)));
  let pore = fbm(uv.x * 14.0 + seed, uv.y * 14.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(coral, voidc, scale * 0.35);
  col = mix(col, gloss, smoothstep(0.44, 0.82, pore));
  col = col + vec3f(0.08, 0.08, 0.06) * speckle(px, 1.8, seed + 6.0, 0.93);
  col = col - vec3f(0.05, 0.03, 0.03) * speckle(px, 3.0, seed + 13.0, 0.945);
  return sat3(col);
}
