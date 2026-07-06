// @material jade_polished
// @slug jade-polished
// @name Polished Jade
// @board neon_surface
// @variant-labels Imperial Green, Lavender Cloud, White Nephrite
// @kind surface
// @tags neon_surface, jade, stone, cloudy
// @author fable-gems_precious
fn jade_polished(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.18, 0.55, 0.36);
  var milk = vec3f(0.62, 0.85, 0.68);
  var vein = vec3f(0.07, 0.30, 0.19);
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.55, 0.46, 0.68); milk = vec3f(0.84, 0.78, 0.90); vein = vec3f(0.32, 0.24, 0.44);
  } else if (variant >= 1.5) {
    body = vec3f(0.78, 0.80, 0.72); milk = vec3f(0.92, 0.93, 0.86); vein = vec3f(0.52, 0.56, 0.46);
  }
  let cloud_a = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 5.0) * 0.5 + 0.5;
  let cloud_b = fbm(uv.x * 11.0, uv.y * 11.0 + seed * 0.7, 4.0) * 0.5 + 0.5;
  var col = mix(body, milk, cloud_a * 0.65 + cloud_b * 0.25);
  let wander = fbm(uv.x * 3.0, uv.y * 3.0 + seed, 4.0);
  let vein_m = line_near(sin((uv.x * 0.7 + uv.y + wander * 0.4) * 14.0 + seed), 0.06);
  col = mix(col, vein, vein_m * 0.45);
  let fleck = smoothstep(0.62, 0.78, fbm(uv.x * 26.0 + seed * 2.0, uv.y * 26.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vein * 0.8, fleck * 0.30);
  let gloss = exp(-pow((uv.x + uv.y - 0.75) * 5.0, 2.0));
  col = mix(col, milk * 1.15, gloss * 0.25);
  col += vec3f(0.95, 1.0, 0.92) * speckle(px, 2.0, seed, 0.998) * 0.2;
  return sat3(col);
}
