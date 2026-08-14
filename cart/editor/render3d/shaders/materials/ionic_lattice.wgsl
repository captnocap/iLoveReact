// @material ionic_lattice
// @slug ionic-lattice
// @name Ionic Lattice
// @board metal_yard
// @variant-labels Coarse Mesh, Charged Mesh, Burnt Mesh
// @kind surface
// @tags metal_yard, lattice, ionic, corrosion
// @author editor
fn ionic_lattice(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var plate = vec3f(0.15, 0.16, 0.18);
  var line = vec3f(0.82, 0.86, 0.90);
  var rust = vec3f(0.54, 0.22, 0.14);
  if (variant > 0.5 && variant < 1.5) {
    plate = vec3f(0.12, 0.13, 0.15);
    line = vec3f(0.95, 0.98, 1.00);
    rust = vec3f(0.33, 0.16, 0.06);
  } else if (variant >= 1.5) {
    plate = vec3f(0.20, 0.22, 0.24);
    line = vec3f(0.55, 0.66, 0.73);
    rust = vec3f(0.86, 0.36, 0.10);
  }
  let grid = 1.0 - smoothstep(0.17, 0.20, abs(fract((uv.x + seed * 0.11) * 18.0) - 0.5));
  let cross = 1.0 - smoothstep(0.17, 0.20, abs(fract((uv.y + seed * 0.07) * 18.0) - 0.5));
  let map = max(grid, cross) * (0.35 + fbm(uv.x * 8.0 + seed, uv.y * 8.0, 4.0) * 0.5);
  var col = mix(plate, line, map * 0.72);
  col = mix(col, rust, crack_field(uv, seed + 6.0, 20.0) * 0.4);
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 2.1, seed + 8.0, 0.965);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 1.6, seed + 13.0, 0.93);
  return sat3(col);
}
