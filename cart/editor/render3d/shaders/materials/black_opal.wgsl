// @material black_opal
// @slug black-opal
// @name Black Opal
// @board neon_surface
// @variant-labels Green Harlequin, Red Ember Play, Electric Ribbon
// @kind surface
// @tags neon_surface, opal, dark, colorplay
// @author fable-gems_precious
fn black_opal(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.05, 0.06, 0.10);
  var potch = vec3f(0.12, 0.14, 0.20);
  var hue_base = 0.30;
  var hue_span = 0.35;
  var patch_gain = 0.75;
  if (variant > 0.5 && variant < 1.5) {
    hue_base = 0.94; hue_span = 0.20; body = vec3f(0.08, 0.04, 0.05); potch = vec3f(0.18, 0.10, 0.11);
  } else if (variant >= 1.5) {
    hue_base = 0.52; hue_span = 0.18; patch_gain = 0.95;
    body = vec3f(0.03, 0.05, 0.10); potch = vec3f(0.08, 0.12, 0.22);
  }
  let murk = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5;
  var col = mix(body, potch, murk);
  let vc = voronoi(uv.x * 8.0 + seed * 0.41, uv.y * 8.0);
  let cid = fract(vc.y * 9.73);
  let gate = smoothstep(0.45, 0.72, fbm(uv.x * 3.5, uv.y * 3.5 + seed * 1.1, 3.0) * 0.5 + 0.5);
  let opalPatch = smoothstep(0.50, 0.10, vc.x) * gate;
  let flash = hsv2rgb(fract(hue_base + cid * hue_span), 0.95, 1.0);
  col = mix(col, flash, opalPatch * patch_gain);
  let ribbon = line_near(sin((uv.x + murk * 0.4) * 20.0 + seed), 0.10) * gate;
  col = mix(col, hsv2rgb(fract(hue_base + 0.5), 0.9, 0.9), ribbon * 0.30);
  col += vec3f(0.90, 0.95, 1.0) * speckle(px, 2.0, seed + 8.0, 0.994) * 0.5;
  return sat3(col);
}
