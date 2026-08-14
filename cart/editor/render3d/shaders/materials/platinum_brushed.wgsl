// @material platinum_brushed
// @slug platinum-brushed
// @name Brushed Platinum
// @board neon_surface
// @variant-labels Vertical Grain, Crosshatch Mill, Matte Slate
// @kind surface
// @tags neon_surface, metal, platinum, brushed
// @author fable-gems_precious
fn platinum_brushed(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.76, 0.79, 0.83);
  var deep_t = vec3f(0.42, 0.45, 0.51);
  var hot = vec3f(0.96, 0.97, 1.0);
  let grain_a = fbm(uv.x * 130.0 + seed, uv.y * 2.5, 4.0) * 0.5 + 0.5;
  let grain_b = fbm(uv.x * 2.5, uv.y * 130.0 + seed * 1.3, 4.0) * 0.5 + 0.5;
  var grain = grain_a;
  if (variant > 0.5 && variant < 1.5) {
    grain = max(grain_a, grain_b) * 0.72 + min(grain_a, grain_b) * 0.28;
    body = vec3f(0.70, 0.73, 0.78); deep_t = vec3f(0.36, 0.39, 0.45);
  } else if (variant >= 1.5) {
    grain = grain_a * 0.4 + (fbm(uv.x * 24.0, uv.y * 24.0 + seed, 4.0) * 0.5 + 0.5) * 0.6;
    body = vec3f(0.55, 0.58, 0.63); deep_t = vec3f(0.30, 0.32, 0.37); hot = vec3f(0.80, 0.83, 0.88);
  }
  var col = mix(deep_t, body, 0.30 + 0.70 * grain);
  let ring_r = length(uv - vec2f(0.5, 0.42 + snoise(seed * 0.2, 0.7) * 0.1));
  let ring = exp(-pow((ring_r - 0.30) * 9.0, 2.0));
  col = mix(col, hot, ring * 0.30);
  let nick_lane = floor(uv.y * 23.0 + seed);
  let nick = line_near(fract(uv.y * 23.0 + seed) - 0.5, 0.012) * step(0.85, rand(vec2f(nick_lane, seed)));
  col = mix(col, deep_t * 0.7, nick * 0.6);
  col += hot * speckle(px, 2.0, seed + 5.0, 0.996) * 0.30;
  return sat3(col);
}
