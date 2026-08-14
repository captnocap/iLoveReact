// @material ceramic_scale
// @slug ceramic-scale
// @name Ceramic Scale
// @board street_ground
// @variant-labels Pale Scale, Deep Scale, Fractured Scale
// @kind surface
// @tags street_ground, ceramic, scale, weather
// @author editor
fn ceramic_scale(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.78, 0.77, 0.72);
  var scale = vec3f(0.50, 0.49, 0.45);
  var scar = vec3f(0.24, 0.22, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.69, 0.68, 0.66);
    scale = vec3f(0.41, 0.41, 0.40);
    scar = vec3f(0.34, 0.33, 0.30);
  } else if (variant >= 1.5) {
    base = vec3f(0.87, 0.82, 0.76);
    scale = vec3f(0.62, 0.58, 0.52);
    scar = vec3f(0.50, 0.47, 0.44);
  }
  let tile = 1.0 - smoothstep(0.26, 0.30, abs(fract((uv.x + uv.y * 0.35) * 18.0 + seed) - 0.5));
  let haze = fbm(uv.x * 10.0 + seed, uv.y * 4.0, 4.0) * 0.5 + 0.5;
  var col = mix(base, scale, smoothstep(0.38, 0.74, haze));
  col = mix(col, scar, tile * 0.38);
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 2.0, seed + 6.0, 0.96);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 2.9, seed + 13.0, 0.93);
  return sat3(col);
}
