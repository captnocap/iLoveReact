// @material emerald_facets
// @slug emerald-facets
// @name Emerald Step Cut
// @board neon_surface
// @variant-labels Colombian Deep, Minty Table, Mossy Jardin
// @kind surface
// @tags neon_surface, emerald, facets, green
// @author fable-gems_precious
fn emerald_facets(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.04, 0.52, 0.30);
  var deep_t = vec3f(0.01, 0.22, 0.12);
  var glassy = vec3f(0.60, 0.95, 0.74);
  var jardin_amt = 0.30;
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.22, 0.68, 0.46); deep_t = vec3f(0.06, 0.34, 0.20); jardin_amt = 0.12;
  } else if (variant >= 1.5) {
    body = vec3f(0.06, 0.40, 0.22); deep_t = vec3f(0.02, 0.16, 0.08);
    glassy = vec3f(0.46, 0.78, 0.56); jardin_amt = 0.55;
  }
  let p = vec2f(abs(uv.x - 0.5) * 1.25, abs(uv.y - 0.5));
  let m = max(p.x, p.y);
  let steps_n = 7.0;
  let ring = floor(m * steps_n * 2.0);
  let ring_id = rand(vec2f(ring, seed * 0.07));
  var col = mix(deep_t, body, 0.35 + 0.65 * ring_id);
  let ring_f = fract(m * steps_n * 2.0);
  col = mix(col, glassy, line_near(ring_f - 0.06, 0.05) * 0.45);
  let corner = line_near(p.x - p.y, 0.012);
  col = mix(col, glassy * 0.8, corner * step(0.12, m) * 0.5);
  let table_m = smoothstep(0.14, 0.10, m);
  col = mix(col, mix(body, glassy, 0.25), table_m * 0.6);
  let jardin = smoothstep(0.55, 0.85, fbm(uv.x * 12.0 + seed, uv.y * 12.0, 4.0) * 0.5 + 0.5);
  col = mix(col, deep_t * 0.8, jardin * jardin_amt);
  col += vec3f(0.88, 1.0, 0.92) * speckle(px, 2.0, seed + 2.0, 0.997) * 0.35;
  return sat3(col);
}
