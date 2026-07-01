// @material water
// @slug water
// @name Water
// @board environment
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags environment, water
// @author legacy
fn water(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let t = U.time;
  let warp = fbm(uv.x * 4.0 + t * 0.08 + seed, uv.y * 4.0 - t * 0.06, 4.0);
  let wave_a = sin((uv.x * 38.0 + uv.y * 11.0) + warp * 5.0 + t * (1.1 + variant * 0.2));
  let wave_b = sin((uv.x * -18.0 + uv.y * 42.0) + snoise(uv.x * 8.0, uv.y * 8.0 + seed) * 3.0 - t * 1.4);
  let caustic = smoothstep(0.72, 0.98, wave_a * 0.5 + wave_b * 0.5);
  var deep = vec3f(0.025, 0.13, 0.22);
  var shallow = vec3f(0.08, 0.55, 0.70);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.010, 0.050, 0.13);
    shallow = vec3f(0.07, 0.27, 0.60);
  } else if (variant >= 1.5) {
    deep = vec3f(0.035, 0.18, 0.17);
    shallow = vec3f(0.19, 0.72, 0.62);
  }
  var col = mix(deep, shallow, sat(uv.y * 0.55 + warp * 0.25 + 0.45)) + vec3f(0.22, 0.36, 0.40) * caustic;
  let foam = line_near(sin(uv.y * 22.0 + uv.x * 8.0 + t * 0.8), 0.035) * smoothstep(0.78, 1.0, variant);
  return sat3(mix(col, vec3f(0.82, 0.95, 0.91), foam * 0.36));
}
