// @material waterfall_veil
// @slug waterfall-veil
// @name Waterfall Veil
// @board environment
// @variant-labels Bright Cascade, Mossy Chute, Night Falls
// @kind surface
// @tags environment, waterfall, veil
// @author fable-water_weather
fn waterfall_veil(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var back_tone = vec3f(0.10, 0.14, 0.16);
  var veil_tone = vec3f(0.72, 0.84, 0.88);
  var bright = vec3f(0.94, 0.98, 1.0);
  var mist_tone = vec3f(0.80, 0.88, 0.90);
  if (variant > 0.5 && variant < 1.5) {
    back_tone = vec3f(0.08, 0.14, 0.08);
    veil_tone = vec3f(0.62, 0.78, 0.74);
    mist_tone = vec3f(0.70, 0.82, 0.76);
  } else if (variant >= 1.5) {
    back_tone = vec3f(0.03, 0.04, 0.08);
    veil_tone = vec3f(0.30, 0.40, 0.52);
    bright = vec3f(0.66, 0.76, 0.88);
    mist_tone = vec3f(0.36, 0.44, 0.54);
  }
  let rockn = fbm(uv.x * 7.0 + seed, uv.y * 7.0, 3.0) * 0.5 + 0.5;
  var col = back_tone * (0.6 + 0.8 * rockn);
  let sway = fbm(uv.x * 2.0 + seed, uv.y * 1.5, 2.0) * 0.15;
  let strand = fbm((uv.x + sway) * 22.0 + seed, uv.y * 2.5 - seed, 4.0) * 0.5 + 0.5;
  let fall = smoothstep(0.35, 0.65, strand);
  let stretch = sin(uv.y * 60.0 + strand * 25.0 + seed) * 0.5 + 0.5;
  var water = mix(veil_tone * 0.8, veil_tone, stretch);
  water = mix(water, bright, smoothstep(0.72, 0.95, strand));
  col = mix(col, water, fall * 0.9);
  let plume = smoothstep(0.55, 1.0, uv.y) * (fbm(uv.x * 6.0 - seed, uv.y * 4.0 + seed, 3.0) * 0.5 + 0.5);
  col = mix(col, mist_tone, plume * 0.75);
  let fleck = speckle(px, 2.0, seed + 3.0, 0.95) * max(fall, plume);
  col = mix(col, bright, fleck * 0.5);
  return sat3(col);
}
