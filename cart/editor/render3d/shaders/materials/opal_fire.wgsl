// @material opal_fire
// @slug opal-fire
// @name Fire Opal White
// @board neon_surface
// @variant-labels Milk Flash, Honey Body, Blue Pinfire
// @kind surface
// @tags neon_surface, opal, iridescent, flash
// @author fable-gems_precious
fn opal_fire(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.90, 0.89, 0.86);
  var undertone = vec3f(0.72, 0.74, 0.80);
  var flash_gain = 0.55;
  var hue_shift = 0.0;
  var cell_sc = 7.0;
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.88, 0.78, 0.58); undertone = vec3f(0.68, 0.55, 0.38);
    hue_shift = 0.06; flash_gain = 0.48;
  } else if (variant >= 1.5) {
    body = vec3f(0.82, 0.86, 0.90); undertone = vec3f(0.58, 0.66, 0.78);
    hue_shift = 0.55; cell_sc = 13.0; flash_gain = 0.65;
  }
  let haze = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5;
  var col = mix(undertone, body, haze);
  let vc = voronoi(uv.x * cell_sc + seed * 0.37, uv.y * cell_sc);
  let hue = fract(vc.y * 5.13 + hue_shift + seed * 0.001);
  let gate = smoothstep(0.35, 0.75, fbm(uv.x * 3.0, uv.y * 3.0 + seed * 1.7, 3.0) * 0.5 + 0.5);
  let opalPatch = smoothstep(0.55, 0.15, vc.x);
  col = mix(col, hsv2rgb(hue, 0.85, 1.0), opalPatch * gate * flash_gain);
  let grain = fbm(uv.x * 40.0, uv.y * 40.0 + seed, 3.0) * 0.5 + 0.5;
  col = mix(col * 0.92, col * 1.06, grain);
  col += vec3f(1.0, 0.98, 0.92) * speckle(px, 2.0, seed + 9.0, 0.995) * 0.45;
  return sat3(col);
}
