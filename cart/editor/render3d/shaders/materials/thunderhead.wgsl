// @material thunderhead
// @slug thunderhead
// @name Thunderhead
// @board environment
// @variant-labels Anvil Noon, Sunset Tower, Green Menace
// @kind composition
// @tags environment, storm, cloud
// @author fable-water_weather
fn thunderhead(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sky_top = vec3f(0.30, 0.48, 0.70);
  var sky_low = vec3f(0.60, 0.66, 0.72);
  var cloud_lit = vec3f(0.95, 0.95, 0.92);
  var cloud_shade = vec3f(0.34, 0.36, 0.42);
  var cloud_base = vec3f(0.14, 0.15, 0.19);
  if (variant > 0.5 && variant < 1.5) {
    sky_top = vec3f(0.24, 0.14, 0.34);
    sky_low = vec3f(0.86, 0.44, 0.26);
    cloud_lit = vec3f(0.98, 0.72, 0.44);
    cloud_shade = vec3f(0.36, 0.20, 0.32);
    cloud_base = vec3f(0.16, 0.09, 0.16);
  } else if (variant >= 1.5) {
    sky_top = vec3f(0.20, 0.28, 0.24);
    sky_low = vec3f(0.42, 0.48, 0.38);
    cloud_lit = vec3f(0.78, 0.82, 0.70);
    cloud_shade = vec3f(0.24, 0.28, 0.24);
    cloud_base = vec3f(0.10, 0.12, 0.10);
  }
  var col = mix(sky_top, sky_low, uv.y);
  let billow = fbm(uv.x * 4.0 + seed, uv.y * 4.0 - seed, 4.0) * 0.5 + 0.5;
  let towerline = 0.30 + snoise(uv.x * 2.0 + seed, seed * 0.3) * 0.12;
  let body = smoothstep(towerline - 0.15, towerline + 0.25, uv.y + (billow - 0.5) * 0.5);
  let puff = fbm(uv.x * 8.0 - seed, uv.y * 8.0 + seed * 0.6, 4.0) * 0.5 + 0.5;
  let lit_side = sat(1.0 - uv.x * 0.9 + (puff - 0.5) * 0.8);
  var cloud = mix(cloud_shade, cloud_lit, lit_side * puff * 1.4);
  cloud = mix(cloud, cloud_base, smoothstep(0.6, 0.95, uv.y) * 0.85);
  cloud = mix(cloud, cloud_lit, smoothstep(0.6, 0.9, puff) * (1.0 - uv.y) * 0.5);
  col = mix(col, cloud, body);
  let rim = smoothstep(0.06, 0.0, abs(uv.y + (billow - 0.5) * 0.5 - towerline)) * (1.0 - body * 0.5);
  col = mix(col, cloud_lit * 1.1, rim * 0.7);
  let flicker = speckle(px, 3.0, seed + 6.0, 0.992);
  col = col + vec3f(0.20, 0.20, 0.26) * flicker * body;
  return sat3(col);
}
