// @material tide_pool
// @slug tide-pool
// @name Tide Pool
// @board environment
// @variant-labels Anemone Garden, Kelp Bowl, Low Tide Bare
// @kind composition
// @tags environment, pool, rock
// @author fable-water_weather
fn tide_pool(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var rock_tone = vec3f(0.22, 0.19, 0.17);
  var pool_deep = vec3f(0.04, 0.26, 0.30);
  var pool_shallow = vec3f(0.16, 0.48, 0.46);
  var life_tone = vec3f(0.78, 0.24, 0.34);
  var life_amt = 1.0;
  if (variant > 0.5 && variant < 1.5) {
    pool_deep = vec3f(0.05, 0.20, 0.16);
    pool_shallow = vec3f(0.18, 0.40, 0.28);
    life_tone = vec3f(0.28, 0.44, 0.16);
    life_amt = 0.7;
  } else if (variant >= 1.5) {
    rock_tone = vec3f(0.28, 0.25, 0.22);
    pool_deep = vec3f(0.10, 0.24, 0.28);
    pool_shallow = vec3f(0.30, 0.44, 0.44);
    life_amt = 0.25;
  }
  let wob = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 3.0) * 0.18;
  let d = length((uv - vec2f(0.5, 0.5)) * vec2f(1.0, 1.25)) + wob;
  let pool_mask = smoothstep(0.40, 0.34, d);
  let rock_bump = fbm(uv.x * 9.0 - seed, uv.y * 9.0 + seed, 4.0) * 0.5 + 0.5;
  var col = rock_tone * (0.7 + 0.6 * rock_bump);
  let wet_rim = smoothstep(0.50, 0.40, d) * (1.0 - pool_mask);
  col = mix(col, rock_tone * 0.55 + vec3f(0.02, 0.05, 0.06), wet_rim);
  let depth = smoothstep(0.34, 0.05, d);
  var water = mix(pool_shallow, pool_deep, depth);
  let caustic = line_near(sin(uv.x * 26.0 + seed) * sin(uv.y * 22.0 - seed), 0.09);
  water = water + vec3f(0.08, 0.12, 0.12) * caustic;
  let vor = voronoi(uv.x * 14.0 + seed, uv.y * 14.0 - seed);
  let keep = step(1.0 - 0.4 * life_amt, rand(vec2f(vor.y, seed + 9.0)));
  let bud = smoothstep(0.20, 0.05, vor.x) * keep * pool_mask * depth;
  water = mix(water, life_tone, bud * 0.9);
  water = mix(water, life_tone * 1.5, smoothstep(0.06, 0.0, vor.x) * keep * pool_mask * depth * 0.6);
  col = mix(col, water, pool_mask);
  col = mix(col, vec3f(0.85, 0.90, 0.88), speckle(px, 2.0, seed + 4.0, 0.975) * wet_rim);
  return sat3(col);
}
