// @material koi_scales
// @slug koi-scales
// @name Koi Scales
// @board props
// @variant-labels Kohaku Red, Sanke Sumi, Yamabuki Gold
// @kind surface
// @tags props, scales, fish
// @author fable-creature_skins
fn koi_scales(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var whitec = vec3f(0.94, 0.92, 0.88);
  var markc = vec3f(0.88, 0.34, 0.10);
  var sumic = vec3f(0.12, 0.10, 0.11);
  var sumiAmt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    sumiAmt = 1.0;
  } else if (variant >= 1.5) {
    markc = vec3f(0.93, 0.72, 0.20);
    whitec = vec3f(0.95, 0.93, 0.86);
  }
  let n1 = fbm(uv.x * 2.2 + seed, uv.y * 2.2 - seed * 0.5, 4.0) * 0.5 + 0.5;
  let n2 = fbm(uv.x * 3.1 - seed, uv.y * 2.8 + seed, 4.0) * 0.5 + 0.5;
  let markm = smoothstep(0.48, 0.54, n1);
  let sumim = smoothstep(0.58, 0.63, n2) * sumiAmt;
  let p = vec2f(uv.x * 14.0 + seed * 0.19, uv.y * 18.0);
  let row = floor(p.y);
  let fx = fract(p.x + fract(row * 0.5));
  let fy = fract(p.y);
  let arc = length(vec2f((fx - 0.5) * 1.2, (fy - 0.04) * 0.9));
  let inside = 1.0 - smoothstep(0.44, 0.54, arc);
  var col = mix(whitec, markc, markm);
  col = mix(col, sumic, sumim);
  col = col * (0.80 + inside * 0.24);
  col = col - vec3f(0.10, 0.08, 0.07) * smoothstep(0.55, 0.95, fy) * inside * 0.5;
  let sheen = pow(sat(sin((uv.x + uv.y) * 4.0 + seed * 0.07)), 4.0);
  col = col + vec3f(0.14, 0.13, 0.11) * sheen * inside;
  col = col - vec3f(0.06, 0.05, 0.05) * speckle(px, 3.0, seed + 3.0, 0.95);
  return sat3(col);
}
