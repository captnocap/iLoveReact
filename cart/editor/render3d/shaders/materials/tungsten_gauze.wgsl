// @material tungsten_gauze
// @slug tungsten-gauze
// @name Tungsten Gauze
// @board wall_props
// @variant-labels Fine Mesh, Hot Mesh, Burn Mesh
// @kind surface
// @tags wall_props, tungsten, mesh, gauze
// @author editor
fn tungsten_gauze(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var knit = vec3f(0.22, 0.20, 0.18);
  var fil = vec3f(0.82, 0.72, 0.50);
  var edge = vec3f(0.12, 0.08, 0.03);
  if (variant > 0.5 && variant < 1.5) {
    knit = vec3f(0.19, 0.17, 0.14);
    fil = vec3f(0.96, 0.90, 0.73);
    edge = vec3f(0.33, 0.18, 0.09);
  } else if (variant >= 1.5) {
    knit = vec3f(0.29, 0.26, 0.22);
    fil = vec3f(0.55, 0.45, 0.30);
    edge = vec3f(0.07, 0.05, 0.02);
  }
  let warp = 1.0 - smoothstep(0.045, 0.06, abs(fract((uv.x + seed * 0.2) * 24.0) - 0.5));
  let weft = 1.0 - smoothstep(0.045, 0.06, abs(fract((uv.y + seed * 0.14) * 24.0) - 0.5));
  let lattice = max(warp, weft);
  var col = mix(knit, fil, lattice * 0.62);
  col = mix(col, edge, crack_field(uv, seed + 1.0, 13.0) * (0.25 + fbm(uv.x * 6.0, uv.y * 6.0, 4.0) * 0.5));
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 1.9, seed + 9.0, 0.97);
  col = col - vec3f(0.05, 0.05, 0.05) * speckle(px, 2.6, seed + 4.0, 0.94);
  return sat3(col);
}
