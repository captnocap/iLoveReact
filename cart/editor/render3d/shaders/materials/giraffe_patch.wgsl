// @material giraffe_patch
// @slug giraffe-patch
// @name Giraffe Patch
// @board props
// @variant-labels Masai Amber, Reticulated Deep, Sun Bleached
// @kind surface
// @tags props, hide, patches
// @author fable-creature_skins
fn giraffe_patch(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var seamc = vec3f(0.94, 0.87, 0.70);
  var patchc = vec3f(0.70, 0.45, 0.20);
  var deepc = vec3f(0.48, 0.28, 0.12);
  var cells = 5.0;
  if (variant > 0.5 && variant < 1.5) {
    seamc = vec3f(0.96, 0.91, 0.79);
    patchc = vec3f(0.52, 0.30, 0.14);
    deepc = vec3f(0.32, 0.17, 0.08);
    cells = 4.2;
  } else if (variant >= 1.5) {
    seamc = vec3f(0.93, 0.89, 0.80);
    patchc = vec3f(0.80, 0.62, 0.38);
    deepc = vec3f(0.60, 0.42, 0.22);
    cells = 6.0;
  }
  let wig = snoise(uv.x * 9.0 + seed, uv.y * 9.0 - seed) * 0.05;
  let vc = voronoi(uv.x * cells + seed * 0.31 + wig, uv.y * cells - seed * 0.17 - wig);
  let pm = 1.0 - smoothstep(0.26, 0.42, vc.x);
  let tonev = rand(vec2f(vc.y * 13.7, vc.y + seed));
  let inner = fbm(uv.x * 9.0 + vc.y * 5.0, uv.y * 9.0 + seed, 3.0) * 0.5 + 0.5;
  var pc = mix(patchc, deepc, tonev * 0.55 + inner * 0.30);
  var col = mix(seamc, pc, pm);
  col = col - vec3f(0.07, 0.06, 0.05) * speckle(px, 3.0, seed, 0.90);
  col = col + vec3f(0.05, 0.04, 0.02) * smoothstep(0.4, 0.0, uv.y) * 0.6;
  return sat3(col);
}
