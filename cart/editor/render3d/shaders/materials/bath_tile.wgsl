// @material bath_tile
// @slug bath-tile
// @name Bath Tile
// @board condemned
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags condemned, bath, tile
// @author legacy
fn bath_tile(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * (5.0 + variant);
  let cell = floor(grid);
  let local = fract(grid);
  let grout = max(1.0 - smoothstep(0.045, 0.075, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.045, 0.075, min(local.y, 1.0 - local.y)));
  let shade = rand(cell + vec2f(seed, seed));
  var col = mix(vec3f(0.66, 0.69, 0.63), vec3f(0.93, 0.91, 0.82), shade);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.42, 0.57, 0.55), vec3f(0.76, 0.87, 0.82), shade);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.38, 0.32, 0.28), vec3f(0.72, 0.65, 0.55), shade);
  }
  let mildew = grout * (0.45 + 0.55 * smoothstep(0.35, 0.70, fbm(uv.x * 13.0 + seed, uv.y * 13.0, 4.0) * 0.5 + 0.5));
  col = mix(col, vec3f(0.020, 0.055, 0.030), mildew * 0.82);
  col = mix(col, vec3f(0.55, 0.20, 0.055), vertical_drips(uv - vec2f(0.10, 0.0), seed + 5.0, 1.0) * smoothstep(0.40, 1.4, variant) * 0.58);
  return sat3(col - vec3f(crack_field(uv, seed, 11.0) * 0.18 + speckle(px, 1.8, seed, 0.94) * 0.11));
}
