// @material sunset_grad
// @slug sunset-sky
// @name Sunset Sky
// @board neon_surface
// @variant-labels Dusk, Night, Dawn
// @kind gradient
// @tags neon_surface, sunset, sky
// @author legacy
fn sunset_grad(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Outrun dusk: gradient sky, banded sun, reflective grid floor. The skybox /
  // backdrop the world-as-shader-quad wants behind the meshed city.
  var top = vec3f(0.10, 0.04, 0.26);
  var mid = vec3f(0.86, 0.22, 0.42);
  var sun_c = vec3f(1.0, 0.82, 0.30);
  var floor_c = vec3f(0.12, 0.02, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    top = vec3f(0.02, 0.02, 0.10);
    mid = vec3f(0.20, 0.06, 0.34);
    sun_c = vec3f(0.62, 0.30, 0.78);
    floor_c = vec3f(0.02, 0.01, 0.08);
  } else if (variant >= 1.5) {
    top = vec3f(0.18, 0.20, 0.42);
    mid = vec3f(0.96, 0.56, 0.32);
    sun_c = vec3f(1.0, 0.92, 0.62);
    floor_c = vec3f(0.20, 0.10, 0.10);
  }
  let horizon = 0.62;
  var col = vec3f(0.0, 0.0, 0.0);
  if (uv.y < horizon) {
    col = mix(top, mid, uv.y / horizon);
    let sd = length((uv - vec2f(0.5, horizon - 0.04)) * vec2f(1.0, 1.25));
    let sun = 1.0 - smoothstep(0.16, 0.18, sd);
    let band = step(0.5, fract((horizon - uv.y) * 36.0));
    let band_mask = smoothstep(horizon - 0.04, horizon - 0.20, uv.y);
    col = mix(col, sun_c, sun * (1.0 - band * band_mask));
    col = col + sun_c * exp(-sd * 6.0) * 0.4;
  } else {
    let fy = (uv.y - horizon) / (1.0 - horizon);
    col = mix(mid * 0.5, floor_c, fy);
    let persp = fy + 0.05;
    let gx = line_near(fract((uv.x - 0.5) / persp * 6.0) - 0.5, 0.03);
    let gz = line_near(fract(fy * 8.0) - 0.5, 0.04);
    col = col + sun_c * sat(gx + gz) * (1.0 - fy) * 0.5;
  }
  return sat3(col);
}
