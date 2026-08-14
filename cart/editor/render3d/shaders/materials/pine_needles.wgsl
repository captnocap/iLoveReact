// @material pine_needles
// @slug pine-needles
// @name Pine Needle Carpet
// @board environment
// @variant-labels Rust Carpet, Fresh Drop, Deep Duff
// @kind surface
// @tags environment, pine, forest
// @author fable-botanic
fn pine_needles(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var duff_lo = vec3f(0.20, 0.12, 0.06);
  var duff_hi = vec3f(0.44, 0.28, 0.13);
  var needle_c = vec3f(0.55, 0.36, 0.16);
  var green_amt = 0.15;
  if (variant > 0.5 && variant < 1.5) {
    duff_lo = vec3f(0.16, 0.11, 0.06);
    duff_hi = vec3f(0.38, 0.26, 0.12);
    needle_c = vec3f(0.30, 0.42, 0.16);
    green_amt = 0.6;
  } else if (variant >= 1.5) {
    duff_lo = vec3f(0.10, 0.07, 0.04);
    duff_hi = vec3f(0.26, 0.17, 0.09);
    needle_c = vec3f(0.36, 0.24, 0.11);
    green_amt = 0.05;
  }
  let base = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5;
  var col = mix(duff_lo, duff_hi, base);
  let w1 = snoise(uv.x * 4.0 + seed, uv.y * 4.0) * 0.8;
  let n1 = line_near(sin((uv.x * 0.9 + uv.y * 0.35 + w1 * 0.02) * 150.0), 0.26);
  let n2 = line_near(sin((uv.x * 0.3 - uv.y * 0.85 + w1 * 0.03) * 130.0 + seed), 0.26);
  let strew1 = smoothstep(0.35, 0.7, fbm(uv.x * 5.0 + seed * 1.9, uv.y * 5.0, 3.0) * 0.5 + 0.5);
  col = mix(col, needle_c, n1 * strew1 * 0.8);
  col = mix(col, needle_c * 0.75, n2 * (1.0 - strew1) * 0.8);
  let fresh = speckle(px, 3.0, seed + 5.0, 0.93);
  col = mix(col, vec3f(0.22, 0.40, 0.17), fresh * green_amt);
  let cv = voronoi(uv.x * 5.0 + seed * 0.8, uv.y * 5.0);
  let cone = smoothstep(0.13, 0.06, cv.x) * step(0.80, fract(cv.y * 7.77));
  let conetx = 0.5 + 0.5 * sin(cv.x * 90.0);
  col = mix(col, mix(vec3f(0.15, 0.09, 0.05), vec3f(0.36, 0.24, 0.13), conetx), cone);
  let shadow = fbm(uv.x * 2.0 + seed * 3.0, uv.y * 2.0, 3.0) * 0.5 + 0.5;
  col = col * (0.80 + shadow * 0.32);
  return sat3(col);
}
