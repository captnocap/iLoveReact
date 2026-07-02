// @material stucco_facade
// @slug stucco-facade
// @name Stucco Facade
// @board neon_surface
// @variant-labels Pink, Teal, Lilac
// @kind surface
// @tags neon_surface, stucco, facade
// @author legacy
fn stucco_facade(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Pastel stucco wall + lit window grid + neon rim. The canonical CityBuilding /
  // Storefront face — a richer replacement for textures.ts facadeTex.
  let mottle = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 5.0) * 0.5 + 0.5;
  var wall_lo = vec3f(0.42, 0.20, 0.30);
  var wall_hi = vec3f(0.86, 0.52, 0.62);
  var neon = vec3f(0.98, 0.24, 0.62);
  if (variant > 0.5 && variant < 1.5) {
    wall_lo = vec3f(0.10, 0.30, 0.34);
    wall_hi = vec3f(0.34, 0.74, 0.74);
    neon = vec3f(0.10, 0.92, 0.92);
  } else if (variant >= 1.5) {
    wall_lo = vec3f(0.30, 0.22, 0.46);
    wall_hi = vec3f(0.62, 0.50, 0.84);
    neon = vec3f(0.66, 0.36, 0.98);
  }
  let wall = mix(wall_lo, wall_hi, mottle * 0.6 + 0.2);
  let grid = uv * vec2f(4.0, 6.0);
  let cell = floor(grid);
  let local = fract(grid);
  let frame = max(1.0 - smoothstep(0.10, 0.16, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.10, 0.16, min(local.y, 1.0 - local.y)));
  let lit = step(0.46, rand(cell + vec2f(seed, seed * 2.0)));
  let pane_sheen = smoothstep(0.7, 0.95, 1.0 - local.y);
  var glass = mix(vec3f(0.04, 0.05, 0.08), neon, lit * (0.5 + pane_sheen * 0.5));
  glass = mix(glass, vec3f(0.06, 0.07, 0.10), (1.0 - lit) * 0.7);
  var col = mix(glass, wall, frame);
  let rim = max(1.0 - smoothstep(0.0, 0.03, uv.x), 1.0 - smoothstep(0.0, 0.03, 1.0 - uv.x));
  let rim2 = max(1.0 - smoothstep(0.0, 0.03, uv.y), 1.0 - smoothstep(0.0, 0.03, 1.0 - uv.y));
  col = mix(col, neon, sat(rim + rim2) * 0.85);
  return sat3(col - vec3f(speckle(px, 3.0, seed, 0.95) * 0.05));
}
