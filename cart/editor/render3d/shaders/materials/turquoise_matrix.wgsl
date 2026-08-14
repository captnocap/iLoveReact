// @material turquoise_matrix
// @slug turquoise-matrix
// @name Turquoise Matrix
// @board neon_surface
// @variant-labels Sleeping Beauty, Spiderweb Heavy, Green Skystone
// @kind surface
// @tags neon_surface, turquoise, matrix, stone
// @author fable-gems_precious
fn turquoise_matrix(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sky = vec3f(0.18, 0.70, 0.72);
  var pale = vec3f(0.48, 0.85, 0.82);
  var web = vec3f(0.28, 0.20, 0.12);
  var web_amt = 0.45;
  if (variant > 0.5 && variant < 1.5) {
    web_amt = 0.85; sky = vec3f(0.14, 0.58, 0.62); web = vec3f(0.16, 0.11, 0.07);
  } else if (variant >= 1.5) {
    sky = vec3f(0.22, 0.66, 0.48); pale = vec3f(0.52, 0.84, 0.64); web_amt = 0.55;
    web = vec3f(0.34, 0.26, 0.14);
  }
  let vc = voronoi(uv.x * 5.0 + seed * 0.23, uv.y * 5.0);
  let patch_tone = fract(vc.y * 4.31);
  var col = mix(sky, pale, patch_tone * 0.5 + (fbm(uv.x * 8.0 + seed, uv.y * 8.0, 4.0) * 0.5 + 0.5) * 0.4);
  let cr_main = crack_field(uv, seed + 2.0, 4.0);
  let cr_fine = crack_field(uv + vec2f(0.31, 0.17), seed + 9.0, 8.0);
  col = mix(col, web, sat(cr_main * 1.2) * web_amt);
  col = mix(col, web * 1.3, cr_fine * web_amt * 0.5);
  let pit = smoothstep(0.75, 0.92, fbm(uv.x * 20.0, uv.y * 20.0 + seed * 1.9, 3.0) * 0.5 + 0.5);
  col = mix(col, web * 0.8, pit * 0.35);
  let sheen = exp(-pow((uv.y - 0.35) * 4.0, 2.0));
  col = mix(col, pale * 1.1, sheen * 0.18);
  col += vec3f(0.92, 1.0, 0.98) * speckle(px, 2.0, seed, 0.998) * 0.2;
  return sat3(col);
}
