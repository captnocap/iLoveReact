// @material glacier_blue
// @slug glacier-blue
// @name Glacier Blue
// @board environment
// @variant-labels Crevasse Field, Ancient Core, Sunstruck Rim
// @kind surface
// @tags environment, glacier, ice
// @author fable-water_weather
fn glacier_blue(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var surface_ice = vec3f(0.80, 0.90, 0.96);
  var mid_ice = vec3f(0.36, 0.62, 0.82);
  var deep_ice = vec3f(0.06, 0.22, 0.52);
  var crack_scale = 4.0;
  if (variant > 0.5 && variant < 1.5) {
    surface_ice = vec3f(0.58, 0.76, 0.90);
    mid_ice = vec3f(0.20, 0.44, 0.74);
    deep_ice = vec3f(0.03, 0.10, 0.36);
    crack_scale = 2.5;
  } else if (variant >= 1.5) {
    surface_ice = vec3f(0.94, 0.94, 0.90);
    mid_ice = vec3f(0.56, 0.74, 0.84);
    deep_ice = vec3f(0.14, 0.36, 0.60);
    crack_scale = 6.0;
  }
  let depth_n = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(mid_ice, surface_ice, depth_n);
  let basin = fbm(uv.x * 2.0 - seed, uv.y * 2.0 + seed * 0.5, 3.0) * 0.5 + 0.5;
  col = mix(col, mid_ice, smoothstep(0.55, 0.85, basin) * 0.5);
  let cracks = crack_field(uv, seed, crack_scale);
  col = mix(col, deep_ice, cracks * 0.9);
  let crevasse = smoothstep(0.5, 0.85, fbm(uv.x * 3.5 + seed * 0.3, uv.y * 3.5 - seed, 3.0) * 0.5 + 0.5);
  col = mix(col, deep_ice, crevasse * cracks);
  let facet = line_near(sin(uv.x * 40.0 + snoise(uv.x * 4.0, uv.y * 4.0 + seed) * 6.0), 0.10);
  col = mix(col, surface_ice * 1.08, facet * depth_n * 0.5);
  let sparkle = speckle(px, 1.8, seed + 3.0, 0.97);
  col = mix(col, vec3f(1.0, 1.0, 0.98), sparkle * 0.8);
  return sat3(col);
}
