// @material black_mail
// @slug black-mail
// @name Black Mail
// @board contraband
// @variant-labels Carbon Layer, Opaque Layer, Charred Fold
// @kind surface
// @tags contraband, paper, mail, fold
// @author editor
fn black_mail(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.15, 0.14, 0.14);
  var stamp = vec3f(0.78, 0.78, 0.81);
  var flaw = vec3f(0.02, 0.02, 0.03);
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.21, 0.20, 0.19);
    stamp = vec3f(0.70, 0.80, 0.54);
    flaw = vec3f(0.06, 0.02, 0.00);
  } else if (variant >= 1.5) {
    body = vec3f(0.08, 0.08, 0.09);
    stamp = vec3f(0.58, 0.54, 0.56);
    flaw = vec3f(0.24, 0.12, 0.06);
  }
  let grain = fbm(uv.x * 17.0 + seed, uv.y * 17.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(body, vec3f(0.32, 0.31, 0.34), smoothstep(0.48, 0.82, grain));
  let fold = line_near(uv.x * 1.7 - uv.y * 0.18 + sin(uv.y * 15.0 + seed) * 0.03, 0.018);
  col = mix(col, stamp, fold * 0.36);
  let pit = speckle(px, 1.5, seed + 11.0, 0.99);
  col = mix(col, flaw, pit * 0.24);
  let frame = rect_mask(uv, 0.06, 0.94, 0.06, 0.94, 0.004);
  col = mix(col, vec3f(0.10, 0.12, 0.14), (1.0 - frame) * 0.4);
  return sat3(col);
}

