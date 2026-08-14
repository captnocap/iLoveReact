// @material car_paint
// @slug car-paint
// @name Car Paint
// @board neon_surface
// @variant-labels Candy Red, Chrome, Matte Black
// @kind surface
// @tags neon_surface, car, paint
// @author legacy
fn car_paint(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Glossy vehicle body: environment reflection band + metal flake + edge
  // highlight. The vehicle AssetKind has no surface yet. 0 candy-red, 1 chrome,
  // 2 matte-black.
  let env_top = vec3f(0.34, 0.18, 0.46);
  let env_bot = vec3f(0.03, 0.03, 0.05);
  let env = mix(env_top, env_bot, smoothstep(0.0, 1.0, uv.y));
  let s = (uv.y - 0.40) * 7.0;
  let streak = exp(-s * s);
  let flake = speckle(px, 1.6, seed, 0.86) * 0.10;
  var col = vec3f(0.0, 0.0, 0.0);
  if (variant < 0.5) {
    col = vec3f(0.72, 0.06, 0.12) + env * 0.30 + vec3f(1.0, 0.7, 0.7) * streak * 0.7 + vec3f(flake, flake, flake);
  } else if (variant < 1.5) {
    col = env * 1.3 + vec3f(1.0, 1.0, 1.0) * streak * 0.9 + vec3f(flake, flake, flake);
  } else {
    col = vec3f(0.04, 0.04, 0.05) + env * 0.10 + vec3f(0.4, 0.4, 0.4) * streak * 0.25 + vec3f(flake, flake, flake) * 0.4;
  }
  col = col + vec3f(0.5, 0.5, 0.5) * (1.0 - smoothstep(0.0, 0.04, uv.y)) * 0.6;
  return sat3(col);
}
