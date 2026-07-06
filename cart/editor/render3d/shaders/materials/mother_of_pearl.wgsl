// @material mother_of_pearl
// @slug mother-of-pearl
// @name Mother of Pearl
// @board neon_surface
// @variant-labels Silver Nacre, Rose Blush, Deep Lagoon
// @kind surface
// @tags neon_surface, nacre, iridescent, shell
// @author fable-gems_precious
fn mother_of_pearl(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.90, 0.90, 0.88);
  var tint_a = vec3f(0.82, 0.88, 0.94);
  var tint_b = vec3f(0.94, 0.85, 0.88);
  var hue_base = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.93, 0.87, 0.85); tint_a = vec3f(0.95, 0.80, 0.82);
    tint_b = vec3f(0.86, 0.82, 0.92); hue_base = 0.85;
  } else if (variant >= 1.5) {
    body = vec3f(0.72, 0.82, 0.84); tint_a = vec3f(0.58, 0.78, 0.82);
    tint_b = vec3f(0.70, 0.72, 0.88); hue_base = 0.45;
  }
  let flow = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5;
  var col = mix(tint_a, body, flow);
  col = mix(col, tint_b, fbm(uv.x * 9.0, uv.y * 9.0 + seed * 1.3, 4.0) * 0.5 + 0.5);
  let gd = length(uv - vec2f(0.2 + rand(vec2f(seed, 5.0)) * 0.2, 1.1));
  let growth = line_near(sin(gd * 40.0 + flow * 3.0), 0.14);
  col = mix(col, col * 0.86, growth);
  let irid = hsv2rgb(fract(hue_base + flow * 0.6 + uv.x * 0.2), 0.35, 1.0);
  col = mix(col, irid, 0.22);
  let sheen = exp(-pow((uv.x - uv.y + snoise(seed * 0.4, 2.2) * 0.3) * 3.5, 2.0));
  col = mix(col, vec3f(1.0, 0.99, 0.96), sheen * 0.30);
  col += vec3f(1.0, 0.98, 0.95) * speckle(px, 2.0, seed, 0.997) * 0.25;
  return sat3(col);
}
