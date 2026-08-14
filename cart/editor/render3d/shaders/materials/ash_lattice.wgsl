// @material ash_lattice
// @slug ash-lattice
// @name Ash Lattice
// @board wood_brick_stone
// @variant-labels Faded Lattice, Dense Lattice, Carbon Lattice
// @kind surface
// @tags wood_brick_stone, ash, lattice, soot
// @author editor
fn ash_lattice(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var stone = vec3f(0.48, 0.45, 0.43);
  var wire = vec3f(0.78, 0.76, 0.70);
  var soot = vec3f(0.24, 0.22, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    stone = vec3f(0.41, 0.39, 0.37);
    wire = vec3f(0.90, 0.89, 0.86);
    soot = vec3f(0.18, 0.17, 0.15);
  } else if (variant >= 1.5) {
    stone = vec3f(0.60, 0.58, 0.54);
    wire = vec3f(0.50, 0.47, 0.42);
    soot = vec3f(0.73, 0.68, 0.60);
  }
  let mesh = max(
    1.0 - smoothstep(0.13, 0.18, abs(fract((uv.x + seed * 0.18) * 9.0) - 0.5)),
    1.0 - smoothstep(0.13, 0.18, abs(fract((uv.y + seed * 0.14) * 13.0) - 0.5))
  );
  let breakage = crack_field(uv, seed + 4.0, 14.0);
  var col = mix(stone, wire, smoothstep(0.28, 0.74, fbm(uv.x * 7.0 + seed, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5));
  col = mix(col, soot, mesh * 0.52 * (0.4 + breakage));
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.4, seed + 2.0, 0.965);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 1.8, seed + 11.0, 0.94);
  return sat3(col);
}
