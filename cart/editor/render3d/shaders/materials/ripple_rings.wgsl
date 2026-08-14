// @material ripple_rings
// @slug ripple-rings
// @name Ripple Rings
// @board environment
// @variant-labels First Drops, Downpour, Still Pond
// @kind surface
// @tags environment, rain, pond
// @author fable-water_weather
fn ripple_rings(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var pond = vec3f(0.06, 0.16, 0.18);
  var pond_lit = vec3f(0.14, 0.30, 0.30);
  var ring_tone = vec3f(0.75, 0.88, 0.86);
  var drop_count = 5.0;
  var ring_freq = 42.0;
  if (variant > 0.5 && variant < 1.5) {
    pond = vec3f(0.08, 0.12, 0.20);
    pond_lit = vec3f(0.16, 0.24, 0.36);
    drop_count = 8.0;
    ring_freq = 55.0;
  } else if (variant >= 1.5) {
    pond = vec3f(0.05, 0.18, 0.14);
    pond_lit = vec3f(0.12, 0.34, 0.24);
    ring_tone = vec3f(0.82, 0.92, 0.84);
    drop_count = 3.0;
    ring_freq = 30.0;
  }
  let murk = fbm(uv.x * 4.0 + seed, uv.y * 4.0 - seed, 3.0) * 0.5 + 0.5;
  var col = mix(pond, pond_lit, murk);
  var glow = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    if (f32(i) >= drop_count) { break; }
    let fi = f32(i);
    let cx = rand(vec2f(fi * 3.1, seed));
    let cy = rand(vec2f(seed, fi * 7.7));
    let age = rand(vec2f(fi + 40.0, seed * 0.5));
    let d = length(uv - vec2f(cx, cy));
    let wavelet = sin(d * ring_freq - age * 9.0) * 0.5 + 0.5;
    let fade = smoothstep(0.35 * (0.4 + age), 0.05, d) * smoothstep(0.0, 0.03, d);
    glow = max(glow, pow(wavelet, 3.0) * fade);
  }
  col = mix(col, ring_tone, glow * 0.7);
  let sheen = line_near(sin(uv.x * 14.0 + seed) * sin(uv.y * 12.0 - seed), 0.12);
  col = col + vec3f(0.04, 0.07, 0.07) * sheen;
  return sat3(col);
}
