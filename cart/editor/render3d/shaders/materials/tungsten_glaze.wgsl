// @material tungsten_glaze
// @slug tungsten-glaze
// @name Tungsten Glaze
// @board neon_surface
// @variant-labels Matte Glaze, Frost Glaze, Burn Glaze
// @kind surface
// @tags neon_surface, tungsten, glaze, ceramic
// @author editor
fn tungsten_glaze(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var matte = vec3f(0.38, 0.38, 0.38);
  var glaze = vec3f(0.98, 0.98, 0.98);
  var dark = vec3f(0.08, 0.08, 0.09);
  if (variant > 0.5 && variant < 1.5) {
    matte = vec3f(0.30, 0.30, 0.31);
    glaze = vec3f(0.90, 0.97, 1.00);
    dark = vec3f(0.18, 0.18, 0.20);
  } else if (variant >= 1.5) {
    matte = vec3f(0.22, 0.22, 0.23);
    glaze = vec3f(1.00, 0.74, 0.42);
    dark = vec3f(0.34, 0.23, 0.16);
  }
  let ring = max(
    1.0 - smoothstep(0.15, 0.22, abs(fract((uv.x + seed * 0.11) * 16.0) - 0.5)),
    1.0 - smoothstep(0.15, 0.22, abs(fract((uv.y + seed * 0.17) * 16.0) - 0.5))
  );
  let veil = fbm(uv.x * 10.0 + seed, uv.y * 5.0 + seed * 0.2, 4.0) * 0.5 + 0.5;
  var col = mix(matte, glaze, smoothstep(0.3, 0.8, veil));
  col = mix(col, dark, ring * 0.22);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.0, seed + 6.0, 0.975);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 3.0, seed + 12.0, 0.945);
  return sat3(col);
}
