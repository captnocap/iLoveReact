// @material oil_slick
// @slug oil-slick
// @name Oil Slick
// @board environment
// @variant-labels Fresh Spill, Old Stain, Puddle Swirl
// @kind surface
// @tags environment, oil, iridescent
// @author fable-water_weather
fn oil_slick(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var road_tone = vec3f(0.09, 0.09, 0.10);
  var slick_base = vec3f(0.05, 0.05, 0.07);
  var sheen_amt = 0.85;
  var swirl_scale = 4.0;
  if (variant > 0.5 && variant < 1.5) {
    road_tone = vec3f(0.13, 0.12, 0.12);
    slick_base = vec3f(0.10, 0.09, 0.09);
    sheen_amt = 0.45;
    swirl_scale = 6.0;
  } else if (variant >= 1.5) {
    road_tone = vec3f(0.07, 0.08, 0.09);
    slick_base = vec3f(0.04, 0.05, 0.08);
    sheen_amt = 0.70;
    swirl_scale = 3.0;
  }
  let grain = speckle(px, 2.0, seed, 0.88);
  var col = road_tone * (0.8 + 0.3 * (fbm(uv.x * 7.0 + seed, uv.y * 7.0, 3.0) * 0.5 + 0.5));
  col = col + vec3f(0.04, 0.04, 0.04) * grain;
  var slick = 0.0;
  slick = max(slick, blotch(uv, vec2f(0.45, 0.5), 0.34, vec2f(0.7, 0.7), seed + 2.0));
  slick = max(slick, blotch(uv, vec2f(0.72, 0.3), 0.16, vec2f(0.6, 0.6), seed + 6.0));
  let slick_mask = smoothstep(0.30, 0.55, slick);
  col = mix(col, slick_base, slick_mask);
  let swa = fbm(uv.x * swirl_scale + seed, uv.y * swirl_scale - seed, 3.0);
  let swb = fbm(uv.x * swirl_scale * 2.1 - seed, uv.y * swirl_scale * 2.1 + seed * 0.5, 3.0);
  let film = fract(swa * 2.2 + swb * 1.3 + seed * 0.05);
  let rainbow = hsv2rgb(film, 0.85, 0.75);
  let band = smoothstep(0.15, 0.5, abs(fract(film * 3.0) - 0.5));
  col = mix(col, rainbow, slick_mask * band * sheen_amt);
  let edge = smoothstep(0.28, 0.36, slick) * (1.0 - smoothstep(0.42, 0.58, slick));
  col = mix(col, vec3f(0.62, 0.48, 0.70), edge * sheen_amt * 0.6);
  let glint = line_near(sin(uv.x * 22.0 + seed) * sin(uv.y * 18.0 - seed), 0.10);
  col = col + vec3f(0.05, 0.05, 0.06) * glint * slick_mask;
  return sat3(col);
}
