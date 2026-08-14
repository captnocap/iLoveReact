// @material cow_hide
// @slug cow-hide
// @name Cow Hide
// @board props
// @variant-labels Holstein Black, Hereford Brown, Tri Color
// @kind surface
// @tags props, hide, patches
// @author fable-creature_skins
fn cow_hide(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var basec = vec3f(0.93, 0.91, 0.86);
  var patchc = vec3f(0.09, 0.08, 0.08);
  var patch2 = vec3f(0.09, 0.08, 0.08);
  if (variant > 0.5 && variant < 1.5) {
    patchc = vec3f(0.44, 0.24, 0.12);
    patch2 = vec3f(0.44, 0.24, 0.12);
    basec = vec3f(0.92, 0.88, 0.80);
  } else if (variant >= 1.5) {
    patchc = vec3f(0.11, 0.09, 0.09);
    patch2 = vec3f(0.50, 0.28, 0.13);
  }
  let warp = snoise(uv.x * 4.0 + seed, uv.y * 4.0) * 0.12;
  let n1 = fbm(uv.x * 2.6 + seed + warp, uv.y * 2.6 - seed, 4.0) * 0.5 + 0.5;
  let n2 = fbm(uv.x * 3.2 - seed * 0.7, uv.y * 3.0 + seed + warp, 4.0) * 0.5 + 0.5;
  let m1 = smoothstep(0.50, 0.56, n1);
  let m2 = smoothstep(0.55, 0.60, n2) * smoothstep(1.5, 1.6, variant);
  let hair = fbm(uv.x * 48.0, uv.y * 12.0 + seed, 3.0) * 0.5 + 0.5;
  var col = basec * (0.92 + hair * 0.12);
  col = mix(col, patchc * (0.85 + hair * 0.30), m1);
  col = mix(col, patch2 * (0.85 + hair * 0.30), m2 * (1.0 - m1));
  col = col - vec3f(0.08, 0.07, 0.06) * (fbm(uv.x * 1.4, uv.y * 1.4 + seed, 3.0) * 0.5 + 0.5) * 0.4;
  col = mix(col, vec3f(0.97, 0.95, 0.90), speckle(px, 2.0, seed, 0.96) * (1.0 - m1) * 0.4);
  return sat3(col);
}
