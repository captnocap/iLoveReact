// @material pool_tile_vice
// @slug pool-tile
// @name Pool Tile
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, pool, tile
// @author legacy
fn pool_tile_vice(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * (vec2f(6.0, 6.0) + vec2f(variant, variant * 0.5));
  let cell = floor(grid);
  let local = fract(grid);
  let grout = max(1.0 - smoothstep(0.035, 0.070, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.035, 0.070, min(local.y, 1.0 - local.y)));
  let tile_tone = rand(cell + vec2f(seed, seed * 2.0));
  var col = mix(vec3f(0.05, 0.50, 0.62), vec3f(0.48, 0.96, 0.92), tile_tone);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.12, 0.10, 0.42), vec3f(0.96, 0.20, 0.56), tile_tone);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.16, 0.44, 0.34), vec3f(0.86, 0.74, 0.34), tile_tone);
  }
  let caustic = line_near(sin(uv.x * 50.0 + uv.y * 17.0 + U.time * 0.8 + seed), 0.055);
  let mildew = grout * smoothstep(0.40, 0.82, fbm(uv.x * 15.0 + seed, uv.y * 15.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.90, 1.0, 0.85), caustic * 0.18);
  col = mix(col, vec3f(0.015, 0.050, 0.035), mildew * 0.78);
  return neon_grime(uv, px, col, seed + 8.0, variant);
}
