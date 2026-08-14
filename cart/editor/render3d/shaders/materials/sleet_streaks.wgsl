// @material sleet_streaks
// @slug sleet-streaks
// @name Sleet Streaks
// @board environment
// @variant-labels Grey Squall, Streetlight Slant, Icy Whiteout
// @kind surface
// @tags environment, sleet, storm
// @author fable-water_weather
fn sleet_streaks(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sky_hi = vec3f(0.36, 0.38, 0.42);
  var sky_lo = vec3f(0.22, 0.24, 0.28);
  var streak_tone = vec3f(0.80, 0.84, 0.88);
  var slant = 0.55;
  var density = 26.0;
  if (variant > 0.5 && variant < 1.5) {
    sky_hi = vec3f(0.14, 0.12, 0.18);
    sky_lo = vec3f(0.06, 0.05, 0.10);
    streak_tone = vec3f(0.92, 0.82, 0.58);
    slant = 0.80;
    density = 20.0;
  } else if (variant >= 1.5) {
    sky_hi = vec3f(0.58, 0.60, 0.64);
    sky_lo = vec3f(0.44, 0.46, 0.52);
    streak_tone = vec3f(0.94, 0.96, 0.98);
    slant = 0.35;
    density = 36.0;
  }
  let haze = fbm(uv.x * 3.0 + seed, uv.y * 3.0 - seed, 3.0) * 0.5 + 0.5;
  var col = mix(sky_hi, sky_lo, uv.y * 0.7 + haze * 0.3);
  var wet = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let scale = density * (1.0 + fi * 0.6);
    let sx = uv.x + uv.y * slant * (1.0 + fi * 0.15) + rand(vec2f(fi, seed)) * 3.0;
    let lane = floor(sx * scale);
    let fx = fract(sx * scale);
    let lane_seed = rand(vec2f(lane, seed + fi * 11.0));
    let on = step(0.72, lane_seed);
    let y0 = fract(lane_seed * 13.7);
    let seg = smoothstep(0.0, 0.05, uv.y - y0) * (1.0 - smoothstep(y0 + 0.20 + lane_seed * 0.3, y0 + 0.25 + lane_seed * 0.3, uv.y));
    let core = smoothstep(0.5, 0.0, abs(fx - 0.5) * (3.0 + fi * 2.0));
    wet = max(wet, on * seg * core * (1.0 - fi * 0.25));
  }
  col = mix(col, streak_tone, wet * 0.8);
  let bead = speckle(px, 2.0, seed + 9.0, 0.96);
  col = mix(col, streak_tone, bead * 0.5);
  return sat3(col);
}
