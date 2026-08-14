// @material pyrite_cubes
// @slug pyrite-cubes
// @name Pyrite Cubes
// @board neon_surface
// @variant-labels Fools Vein, Loose Boulders, Tarnished Brass
// @kind surface
// @tags neon_surface, pyrite, metal, cubes
// @author fable-gems_precious
fn pyrite_cubes(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var brass_hi = vec3f(0.90, 0.78, 0.38);
  var brass_lo = vec3f(0.55, 0.44, 0.16);
  var rock = vec3f(0.20, 0.18, 0.16);
  var sc = 6.0;
  var fill = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    sc = 3.5; fill = 0.55; rock = vec3f(0.26, 0.23, 0.20);
  } else if (variant >= 1.5) {
    brass_hi = vec3f(0.68, 0.55, 0.28); brass_lo = vec3f(0.36, 0.27, 0.12);
    rock = vec3f(0.14, 0.13, 0.12); sc = 6.0; fill = 0.42;
  }
  var col = mix(rock * 0.7, rock * 1.2, fbm(uv.x * 12.0 + seed, uv.y * 12.0, 4.0) * 0.5 + 0.5);
  let cell = floor(uv * sc);
  let cid = rand(cell + vec2f(seed * 0.017, seed * 0.011));
  let lc = fract(uv * sc);
  let jx = 0.15 + rand(cell + vec2f(3.0, seed)) * 0.25;
  let jy = 0.15 + rand(cell + vec2f(7.0, seed)) * 0.25;
  let cube = rect_mask(lc, jx, jx + 0.45, jy, jy + 0.45, 0.02);
  let has_cube = step(1.0 - fill, cid);
  let split = step(lc.x + lc.y, jx + jy + 0.45);
  var cube_c = mix(brass_lo, brass_hi, 0.3 + 0.7 * fract(cid * 5.3));
  cube_c = mix(cube_c * 0.72, cube_c * 1.22, split);
  let striation = line_near(sin(lc.x * 40.0 + cid * 9.0), 0.20);
  cube_c = mix(cube_c, cube_c * 0.85, striation * 0.6);
  col = mix(col, cube_c, cube * has_cube);
  let edge_hi = line_near(lc.x + lc.y - (jx + jy + 0.45), 0.02);
  col = mix(col, brass_hi * 1.2, edge_hi * cube * has_cube * 0.7);
  col += brass_hi * speckle(px, 2.0, seed + 1.0, 0.995) * 0.45;
  return sat3(col);
}
