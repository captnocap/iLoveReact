// @material gneiss_folded
// @slug gneiss-folded
// @name Folded Gneiss
// @board wood_brick_stone
// @variant-labels Grey Migmatite, Pink Augen, Dark Amphibole
// @kind surface
// @tags wood_brick_stone, gneiss, metamorphic, folded
// @author fable-geology
fn gneiss_folded(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var dark = vec3f(0.20, 0.20, 0.22);
  var lite = vec3f(0.72, 0.70, 0.66);
  var eye = vec3f(0.85, 0.83, 0.78);
  if (variant > 0.5 && variant < 1.5) {
    dark = vec3f(0.30, 0.22, 0.22);
    lite = vec3f(0.78, 0.62, 0.56);
    eye = vec3f(0.90, 0.78, 0.70);
  } else if (variant >= 1.5) {
    dark = vec3f(0.10, 0.11, 0.12);
    lite = vec3f(0.46, 0.46, 0.44);
    eye = vec3f(0.62, 0.60, 0.54);
  }
  let fold = fbm(uv.x * 1.8 + seed * 0.6, uv.y * 1.8 - seed * 0.3, 3.0) * 2.2;
  let fold2 = fbm(uv.x * 5.0 - seed * 0.2, uv.y * 5.0, 3.0);
  let band = sin((uv.y + fold * 0.4 + fold2 * 0.12) * 26.0 + seed);
  var col = mix(dark, lite, smoothstep(-0.45, 0.55, band));
  let band2 = sin((uv.y + fold * 0.4) * 26.0 * 3.1 + seed * 1.7);
  col = mix(col, dark, smoothstep(0.55, 0.95, band2) * 0.35);
  if (variant > 0.5 && variant < 1.5) {
    let vc = voronoi(uv.x * 7.0 + seed, (uv.y + fold * 0.3) * 12.0);
    let gate = step(0.72, rand(vec2f(vc.y, seed * 0.13)));
    col = mix(col, eye, smoothstep(0.24, 0.08, vc.x) * gate * 0.9);
  }
  let grain = fbm(uv.x * 30.0 + seed, uv.y * 30.0, 3.0);
  col = col * (0.90 + grain * 0.30);
  col = mix(col, eye, speckle(px, 2.0, seed + 4.0, 0.982) * 0.5);
  col = mix(col, dark * 0.6, crack_field(uv, seed + 6.0, 2.5) * 0.5);
  return sat3(col);
}
