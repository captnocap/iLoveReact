// @material garnet_cluster
// @slug garnet-cluster
// @name Garnet Cluster
// @board neon_surface
// @variant-labels Wine Almandine, Ember Spessartine, Plum Rhodolite
// @kind surface
// @tags neon_surface, garnet, crystal, red
// @author fable-gems_precious
fn garnet_cluster(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.48, 0.06, 0.10);
  var deep_t = vec3f(0.16, 0.01, 0.03);
  var glint = vec3f(0.95, 0.45, 0.40);
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.72, 0.28, 0.06); deep_t = vec3f(0.30, 0.09, 0.01); glint = vec3f(1.0, 0.72, 0.35);
  } else if (variant >= 1.5) {
    body = vec3f(0.46, 0.10, 0.30); deep_t = vec3f(0.16, 0.02, 0.10); glint = vec3f(0.88, 0.48, 0.68);
  }
  let vc = voronoi(uv.x * 7.0 + seed * 0.19, uv.y * 7.0);
  let fid = fract(vc.y * 6.19);
  var col = mix(deep_t, body, 0.25 + 0.75 * fid);
  let dome = smoothstep(0.55, 0.05, vc.x);
  col = mix(col * 0.62, col * 1.22, dome);
  col = mix(col, deep_t * 0.7, smoothstep(0.34, 0.50, vc.x));
  let face_split = step(0.5, fract(fid * 3.7 + uv.x * 2.0 + uv.y * 1.3));
  col = mix(col, col * 1.18, face_split * dome * 0.5);
  let lit = step(0.72, fid);
  col = mix(col, glint, lit * smoothstep(0.28, 0.04, vc.x) * 0.45);
  let dust = fbm(uv.x * 30.0 + seed, uv.y * 30.0, 3.0) * 0.5 + 0.5;
  col = mix(col * 0.92, col * 1.06, dust);
  col += glint * speckle(px, 2.0, seed + 6.0, 0.995) * 0.5;
  return sat3(col);
}
