// @material stone_wall
// @slug stone-wall
// @name Stone Wall
// @board second_pass
// @variant-labels Granite, Sandstone, Basalt
// @kind surface
// @tags second_pass, stone, wall
// @author legacy
fn stone_wall(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Coursed ashlar with per-cell edge distortion, thick mortar, lichen on the
  // top edges, and a weathering gradient from top.
  let grid = uv * 3.0;
  let cell = floor(grid);
  let local = fract(grid);
  let distort_x = (rand(cell + vec2f(seed, seed)) - 0.5) * 0.22;
  let distort_y = (rand(cell + vec2f(seed + 1.0, seed * 2.0)) - 0.5) * 0.22;
  let stone_local = local + vec2f(distort_x, distort_y);
  let in_stone = step(0.05, stone_local.x) * step(stone_local.x, 0.95) * step(0.05, stone_local.y) * step(stone_local.y, 0.95);
  let mortar = 1.0 - in_stone;

  var lo = vec3f(0.38, 0.38, 0.40);
  var hi = vec3f(0.62, 0.62, 0.64);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.52, 0.38, 0.24);
    hi = vec3f(0.82, 0.62, 0.38);
  } else if (variant >= 1.5) {
    lo = vec3f(0.18, 0.18, 0.20);
    hi = vec3f(0.32, 0.32, 0.34);
  }
  let stone_tex = fbm(uv.x * 14.0 + seed, uv.y * 14.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(lo, hi, stone_tex);

  let lichen = smoothstep(0.55, 0.82, fbm(uv.x * 8.0 + seed, uv.y * 8.0 - seed, 4.0) * 0.5 + 0.5) * smoothstep(0.0, 0.5, local.y);
  col = mix(col, vec3f(0.35, 0.42, 0.28), lichen * 0.42);
  col = mix(col, vec3f(0.55, 0.53, 0.50), smoothstep(0.0, 0.35, uv.y) * 0.22);
  col = mix(col, vec3f(0.45, 0.43, 0.38), mortar * 0.88);
  return sat3(col - vec3f(speckle(px, 4.0, seed, 0.94) * 0.06));
}
