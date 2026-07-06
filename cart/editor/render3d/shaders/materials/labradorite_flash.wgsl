// @material labradorite_flash
// @slug labradorite-flash
// @name Labradorite Flash
// @board neon_surface
// @variant-labels Blue Schiller, Golden Sheet, Spectral Split
// @kind surface
// @tags neon_surface, labradorite, flash, gray
// @author fable-gems_precious
fn labradorite_flash(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.24, 0.25, 0.28);
  var dark_t = vec3f(0.10, 0.11, 0.13);
  var flash_a = vec3f(0.10, 0.42, 0.95);
  var flash_b = vec3f(0.14, 0.75, 0.85);
  var lit_thresh = 0.55;
  if (variant > 0.5 && variant < 1.5) {
    flash_a = vec3f(0.92, 0.62, 0.12); flash_b = vec3f(0.98, 0.85, 0.35); lit_thresh = 0.62;
  } else if (variant >= 1.5) {
    flash_a = vec3f(0.15, 0.50, 0.90); flash_b = vec3f(0.90, 0.60, 0.15); lit_thresh = 0.45;
  }
  let grain = fbm(uv.x * 16.0 + seed, uv.y * 16.0, 4.0) * 0.5 + 0.5;
  var col = mix(dark_t, body, grain);
  let vc = voronoi(uv.x * 3.5 + seed * 0.31, uv.y * 3.5);
  let cid = fract(vc.y * 7.41);
  let lit = step(lit_thresh, cid);
  let sweep = snoise(uv.x * 2.0 + cid * 8.0, uv.y * 2.0 + seed * 0.5) * 0.5 + 0.5;
  let flash_c = mix(flash_a, flash_b, sweep);
  let cell_body = smoothstep(0.48, 0.20, vc.x);
  col = mix(col, flash_c, lit * cell_body * 0.85);
  let lam = line_near(sin((uv.x * 0.6 + uv.y) * 70.0 + cid * 20.0), 0.20);
  col = mix(col, col * 1.30, lam * lit * cell_body * 0.7);
  col = mix(col, dark_t * 0.8, smoothstep(0.40, 0.52, vc.x) * 0.6);
  col += vec3f(0.85, 0.92, 1.0) * speckle(px, 2.0, seed, 0.997) * 0.3;
  return sat3(col);
}
