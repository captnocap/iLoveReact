// @material deep_water
// @slug deep-water
// @name Deep Water
// @board second_pass
// @variant-labels Deep Ocean, Tropical, Storm Grey
// @kind surface
// @tags second_pass, deep, water
// @author legacy
fn deep_water(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Deep ocean with sharp whitecaps, caustic light, and foam patches.
  var deep = vec3f(0.015, 0.045, 0.12);
  var shallow = vec3f(0.06, 0.32, 0.55);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.02, 0.18, 0.22);
    shallow = vec3f(0.14, 0.68, 0.62);
  } else if (variant >= 1.5) {
    deep = vec3f(0.03, 0.04, 0.06);
    shallow = vec3f(0.18, 0.20, 0.24);
  }
  let depth_grad = smoothstep(0.0, 1.0, uv.y);
  var col = mix(deep, shallow, depth_grad);

  let wave_a = sin(uv.x * 28.0 + uv.y * 8.0 + seed);
  let wave_b = sin(uv.x * -18.0 + uv.y * 22.0 - seed);
  let wave_c = sin(uv.x * 12.0 + uv.y * 35.0 + seed * 0.5);
  let crest = smoothstep(1.4, 1.9, wave_a + wave_b + wave_c);
  col = mix(col, vec3f(0.82, 0.88, 0.92), crest * 0.65);

  let caustic = line_near(sin(uv.x * 20.0 + seed) * sin(uv.y * 16.0 - seed), 0.08);
  col = col + vec3f(0.08, 0.14, 0.16) * caustic * (1.0 - depth_grad * 0.5);

  let foam = speckle(px, 5.5, seed + 4.0, 0.90) * smoothstep(0.6, 0.9, fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.88, 0.92, 0.90), foam * 0.30);
  return sat3(col);
}
