// @material hailstone_bed
// @slug hailstone-bed
// @name Hailstone Bed
// @board environment
// @variant-labels Lawn Scatter, Heavy Fall, Melting Out
// @kind surface
// @tags environment, hail, storm
// @author fable-water_weather
fn hailstone_bed(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var turf_lo = vec3f(0.10, 0.22, 0.08);
  var turf_hi = vec3f(0.20, 0.36, 0.14);
  var stone_tone = vec3f(0.86, 0.90, 0.94);
  var stone_keep = 0.55;
  var stone_r = 0.16;
  if (variant > 0.5 && variant < 1.5) {
    turf_lo = vec3f(0.08, 0.16, 0.07);
    turf_hi = vec3f(0.14, 0.26, 0.11);
    stone_keep = 0.30;
    stone_r = 0.20;
  } else if (variant >= 1.5) {
    turf_lo = vec3f(0.12, 0.24, 0.10);
    turf_hi = vec3f(0.24, 0.40, 0.16);
    stone_tone = vec3f(0.78, 0.86, 0.90);
    stone_keep = 0.72;
    stone_r = 0.11;
  }
  let blades = fbm(uv.x * 24.0 + seed, uv.y * 9.0 - seed, 3.0) * 0.5 + 0.5;
  var col = mix(turf_lo, turf_hi, blades);
  let fleck = speckle(px, 2.0, seed + 1.0, 0.92);
  col = mix(col, turf_hi * 1.2, fleck * 0.4);
  let wetten = fbm(uv.x * 4.0 - seed, uv.y * 4.0 + seed, 3.0) * 0.5 + 0.5;
  col = mix(col, turf_lo * 0.7, wetten * 0.35);
  let vor = voronoi(uv.x * 10.0 + seed, uv.y * 10.0 - seed);
  let keep = step(1.0 - stone_keep, rand(vec2f(vor.y, seed + 4.0)));
  let sz = stone_r * (0.6 + 0.8 * rand(vec2f(vor.y * 2.3, seed)));
  let ball = smoothstep(sz, sz - 0.05, vor.x) * keep;
  let shine = smoothstep(sz * 0.5, 0.0, vor.x) * keep;
  let ground_shadow = smoothstep(sz + 0.06, sz, vor.x) * (1.0 - ball) * keep;
  col = mix(col, turf_lo * 0.5, ground_shadow * 0.7);
  col = mix(col, stone_tone, ball);
  col = mix(col, vec3f(0.98, 1.0, 1.0), shine * 0.7);
  col = mix(col, stone_tone * 0.75 + vec3f(0.0, 0.02, 0.06), ball * smoothstep(sz - 0.05, sz, vor.x) * 0.6);
  return sat3(col);
}
