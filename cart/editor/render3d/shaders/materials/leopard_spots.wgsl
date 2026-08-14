// @material leopard_spots
// @slug leopard-spots
// @name Leopard Spots
// @board props
// @variant-labels Savanna Tawny, Snow Leopard, Night Panther
// @kind surface
// @tags props, hide, fur, spots
// @author fable-creature_skins
fn leopard_spots(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ground = vec3f(0.80, 0.60, 0.32);
  var rosette = vec3f(0.14, 0.09, 0.05);
  var corec = vec3f(0.64, 0.42, 0.19);
  var cells = 7.0;
  if (variant > 0.5 && variant < 1.5) {
    ground = vec3f(0.84, 0.82, 0.76);
    rosette = vec3f(0.18, 0.16, 0.15);
    corec = vec3f(0.62, 0.58, 0.51);
    cells = 5.5;
  } else if (variant >= 1.5) {
    ground = vec3f(0.15, 0.13, 0.12);
    rosette = vec3f(0.05, 0.05, 0.06);
    corec = vec3f(0.23, 0.19, 0.15);
    cells = 8.5;
  }
  let warp = fbm(uv.x * 3.0 + seed, uv.y * 3.0 - seed * 0.7, 3.0);
  let vc = voronoi(uv.x * cells + warp * 0.9 + seed * 0.37, uv.y * cells + warp * 0.7 - seed * 0.21);
  let ringm = smoothstep(0.14, 0.20, vc.x) * (1.0 - smoothstep(0.27, 0.36, vc.x));
  let breakup = step(0.30, fract(vc.y * 7.31 + snoise(uv.x * 11.0 + seed, uv.y * 11.0) * 0.5 + 0.5));
  let fur = fbm(uv.x * 26.0 - seed, uv.y * 24.0 + seed, 4.0) * 0.5 + 0.5;
  var col = mix(ground * 0.82, ground * 1.12, fur);
  col = mix(col, corec, (1.0 - smoothstep(0.10, 0.18, vc.x)) * 0.85);
  col = mix(col, rosette, ringm * breakup);
  col = mix(col, rosette, speckle(px, 3.0, seed + 4.0, 0.94) * 0.55);
  col = col + vec3f(0.06, 0.05, 0.03) * smoothstep(0.2, 0.9, fur) * 0.5;
  return sat3(col);
}
