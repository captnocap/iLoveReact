// @material puddle_mirror
// @slug puddle-mirror
// @name Puddle Mirror
// @board environment
// @variant-labels Vice Sunset, Blue Morning, Sodium Night
// @kind surface
// @tags environment, puddle, wet
// @author fable-water_weather
fn puddle_mirror(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ground = vec3f(0.10, 0.10, 0.11);
  var sky_a = vec3f(0.90, 0.45, 0.30);
  var sky_b = vec3f(0.30, 0.16, 0.42);
  if (variant > 0.5 && variant < 1.5) {
    ground = vec3f(0.14, 0.14, 0.15);
    sky_a = vec3f(0.62, 0.76, 0.88);
    sky_b = vec3f(0.30, 0.44, 0.62);
  } else if (variant >= 1.5) {
    ground = vec3f(0.07, 0.06, 0.07);
    sky_a = vec3f(0.85, 0.62, 0.20);
    sky_b = vec3f(0.12, 0.08, 0.16);
  }
  let grain = speckle(px, 2.0, seed, 0.90);
  var col = ground * (0.85 + 0.3 * (fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5));
  col = col + vec3f(0.05, 0.05, 0.05) * grain;
  var wet = 0.0;
  wet = max(wet, blotch(uv, vec2f(0.30, 0.35), 0.24, vec2f(0.55, 0.55), seed));
  wet = max(wet, blotch(uv, vec2f(0.72, 0.68), 0.20, vec2f(0.45, 0.45), seed + 3.0));
  wet = max(wet, blotch(uv, vec2f(0.55, 0.15), 0.13, vec2f(0.5, 0.5), seed + 7.0));
  wet = max(wet, blotch(uv, vec2f(0.18, 0.82), 0.15, vec2f(0.6, 0.6), seed + 11.0));
  let ripple = fbm(uv.x * 9.0 - seed, uv.y * 9.0 + seed, 3.0) * 0.5 + 0.5;
  let sky = mix(sky_b, sky_a, sat(1.0 - uv.y + ripple * 0.35 - 0.15));
  col = mix(col, sky, smoothstep(0.35, 0.75, wet));
  let rim = smoothstep(0.30, 0.42, wet) * (1.0 - smoothstep(0.42, 0.60, wet));
  col = mix(col, ground * 0.5, rim * 0.8);
  let shimmer = line_near(sin(uv.x * 30.0 + seed) * sin(uv.y * 8.0 - seed), 0.10);
  col = col + sky_a * shimmer * smoothstep(0.5, 0.8, wet) * 0.25;
  return sat3(col);
}
