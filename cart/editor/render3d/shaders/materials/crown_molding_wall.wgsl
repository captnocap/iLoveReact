// @material crown_molding_wall
// @slug crown-molding-wall
// @name Crown Molding Wall
// @board liminal
// @variant-labels Cream Formal, Rose Sitting Room, Hunter Study
// @kind surface
// @tags liminal, molding, wall, paint
// @author fable-interior_home
fn crown_molding_wall(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var wall = vec3f(0.86, 0.82, 0.72);
  var trim = vec3f(0.93, 0.92, 0.88);
  var scuff = vec3f(0.48, 0.44, 0.38);
  if (variant > 0.5 && variant < 1.5) {
    wall = vec3f(0.80, 0.62, 0.60);
    trim = vec3f(0.92, 0.89, 0.85);
    scuff = vec3f(0.45, 0.32, 0.30);
  } else if (variant >= 1.5) {
    wall = vec3f(0.22, 0.35, 0.28);
    trim = vec3f(0.85, 0.84, 0.78);
    scuff = vec3f(0.12, 0.18, 0.15);
  }
  let mott = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  var col = wall + vec3f((mott - 0.5) * 0.06);
  let m = uv.y / 0.20;
  if (uv.y < 0.20) {
    let curve = sin(m * 3.14159 * 2.2 + 0.6) * 0.5 + 0.5;
    col = trim * (0.72 + curve * 0.38);
    col = mix(col, trim * 0.55, line_near(m - 0.42, 0.05));
    col = mix(col, trim * 1.1, line_near(m - 0.12, 0.06));
  }
  col = mix(col, scuff, smoothstep(0.26, 0.20, uv.y) * step(0.20, uv.y) * 0.35);
  let nick = speckle(px, 3.0, seed + 2.0, 0.975) * step(0.2, uv.y);
  col = mix(col, scuff, nick * 0.7);
  let stain = blotch(uv, vec2f(0.2 + fract(seed * 0.11) * 0.6, 0.6), 0.16, vec2f(0.6, 1.4), seed) * 0.2;
  col = mix(col, scuff, stain);
  col = col + vec3f(0.04) * smoothstep(1.0, 0.2, uv.y);
  return sat3(col);
}
