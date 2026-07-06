// @material basalt_skin
// @slug basalt-skin
// @name Basalt Skin
// @board street_ground
// @variant-labels Dusty Skin, Wet Skin, Oiled Skin
// @kind surface
// @tags street_ground, basalt, road, asphalt
// @author editor
fn basalt_skin(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.22, 0.23, 0.24);
  var scale = vec3f(0.67, 0.67, 0.69);
  var oil = vec3f(0.07, 0.07, 0.08);
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.15, 0.15, 0.16);
    scale = vec3f(0.76, 0.78, 0.79);
    oil = vec3f(0.10, 0.10, 0.12);
  } else if (variant >= 1.5) {
    body = vec3f(0.26, 0.26, 0.28);
    scale = vec3f(0.58, 0.58, 0.62);
    oil = vec3f(0.02, 0.02, 0.03);
  }
  let rough = fbm(uv.x * 10.0 + seed, uv.y * 7.0 + seed * 0.7, 5.0) * 0.5 + 0.5;
  let seam = crack_field(uv + vec2f(seed * 0.13, 0.0), seed + 4.0, 14.0);
  var col = mix(body, scale, rough * 0.21);
  col = mix(col, oil, seam * 0.32);
  let line = 1.0 - smoothstep(0.030, 0.055, abs(fract(uv.x * 16.0 + seed * 0.2) - 0.5));
  col = mix(col, vec3f(0.85, 0.85, 0.87), line * 0.12);
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 2.1, seed + 3.0, 0.965);
  col = col - vec3f(0.05, 0.05, 0.05) * speckle(px, 1.6, seed + 8.0, 0.93);
  return sat3(col);
}
