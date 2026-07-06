// @material neon_trellis
// @slug neon-trellis
// @name Neon Trellis
// @board neon_surface
// @variant-labels Thin Trellis, Thick Trellis, Melting Trellis
// @kind surface
// @tags neon_surface, trellis, neon, lattice
// @author editor
fn neon_trellis(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var trunk = vec3f(0.08, 0.08, 0.10);
  var glow = vec3f(0.16, 0.90, 0.96);
  var ash = vec3f(0.20, 0.02, 0.30);
  if (variant > 0.5 && variant < 1.5) {
    trunk = vec3f(0.12, 0.12, 0.14);
    glow = vec3f(0.96, 0.31, 0.90);
    ash = vec3f(0.45, 0.25, 0.04);
  } else if (variant >= 1.5) {
    trunk = vec3f(0.16, 0.16, 0.18);
    glow = vec3f(0.99, 0.67, 0.19);
    ash = vec3f(0.64, 0.10, 0.14);
  }
  let meshX = 1.0 - smoothstep(0.14, 0.20, abs(fract((uv.x + seed * 0.2) * 12.0) - 0.5));
  let meshY = 1.0 - smoothstep(0.14, 0.20, abs(fract((uv.y + seed * 0.15) * 20.0) - 0.5));
  let trellis = max(meshX, meshY);
  var col = mix(trunk, glow, trellis * 0.62);
  col = mix(col, ash, crack_field(uv, seed + 5.0, 18.0) * 0.32);
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 2.4, seed + 3.0, 0.965);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 1.5, seed + 7.0, 0.94);
  return sat3(col);
}
