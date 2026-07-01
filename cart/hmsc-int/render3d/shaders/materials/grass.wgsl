// @material grass
// @slug grass
// @name Grass
// @board environment
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags environment, grass
// @author legacy
fn grass(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let wind = snoise(uv.x * 2.0 + U.time * 0.30 + seed, uv.y * 4.0 - U.time * 0.30);
  let blade = line_near(sin((uv.x + wind * 0.035) * (88.0 + variant * 18.0) + uv.y * 8.0), 0.18);
  let clump = fbm(uv.x * 8.0 + seed, uv.y * 8.0, 5.0) * 0.5 + 0.5;
  var low = vec3f(0.035, 0.18, 0.070);
  var high = vec3f(0.24, 0.58, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.020, 0.12, 0.065);
    high = vec3f(0.18, 0.46, 0.25);
  } else if (variant >= 1.5) {
    low = vec3f(0.22, 0.19, 0.075);
    high = vec3f(0.62, 0.52, 0.20);
  }
  var col = mix(low, high, clump) + vec3f(0.10, 0.18, 0.06) * blade;
  let seed_head = speckle(px, 8.0, seed, 0.965) * smoothstep(0.15, 0.95, uv.y);
  return sat3(mix(col, vec3f(0.80, 0.72, 0.42), seed_head * (0.28 + variant * 0.10)));
}
