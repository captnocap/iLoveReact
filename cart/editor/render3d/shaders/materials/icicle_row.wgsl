// @material icicle_row
// @slug icicle-row
// @name Icicle Row
// @board environment
// @variant-labels Eave Teeth, Long Daggers, Blue Hour
// @kind composition
// @tags environment, icicle, winter
// @author fable-water_weather
fn icicle_row(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var backdrop = vec3f(0.12, 0.14, 0.20);
  var eave_tone = vec3f(0.16, 0.10, 0.08);
  var ice_body = vec3f(0.68, 0.80, 0.90);
  var ice_core = vec3f(0.90, 0.96, 1.0);
  var cols = 9.0;
  var len_scale = 0.45;
  if (variant > 0.5 && variant < 1.5) {
    backdrop = vec3f(0.08, 0.09, 0.13);
    cols = 6.0;
    len_scale = 0.75;
  } else if (variant >= 1.5) {
    backdrop = vec3f(0.10, 0.10, 0.24);
    eave_tone = vec3f(0.08, 0.07, 0.14);
    ice_body = vec3f(0.52, 0.62, 0.86);
    ice_core = vec3f(0.76, 0.84, 1.0);
    cols = 12.0;
    len_scale = 0.38;
  }
  let hazebg = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 3.0) * 0.5 + 0.5;
  var col = backdrop * (0.75 + 0.5 * hazebg);
  col = mix(col, ice_body * 0.4, speckle(px, 2.0, seed + 1.0, 0.97));
  let eave_y = 0.14 + snoise(uv.x * 3.0 + seed, seed) * 0.02;
  let lane = floor(uv.x * cols);
  let fx = fract(uv.x * cols);
  let lane_r = rand(vec2f(lane, seed));
  let ic_len = len_scale * (0.4 + lane_r * 0.9);
  let drop_y = sat((uv.y - eave_y) / max(ic_len, 0.02));
  let half_w = (1.0 - drop_y) * (0.16 + lane_r * 0.18);
  let wiggle = snoise(lane * 5.0 + seed, uv.y * 9.0) * 0.05;
  let inside = step(abs(fx - 0.5 + wiggle), half_w) * step(eave_y, uv.y) * step(drop_y, 0.999);
  let core_hl = smoothstep(0.5, 0.0, abs(fx - 0.42 + wiggle) / max(half_w, 0.01));
  var ice = mix(ice_body, ice_core, core_hl);
  ice = mix(ice, backdrop * 1.4, smoothstep(0.6, 1.0, drop_y) * 0.3);
  col = mix(col, ice, inside * 0.95);
  col = mix(col, ice_core, inside * smoothstep(0.96, 1.0, 1.0 - drop_y) * 0.4);
  let eave = step(uv.y, eave_y);
  col = mix(col, eave_tone * (0.8 + 0.4 * fract(lane_r * 7.0)), eave);
  col = mix(col, ice_core * 0.9, eave * smoothstep(0.03, 0.0, eave_y - uv.y) * 0.7);
  return sat3(col);
}
