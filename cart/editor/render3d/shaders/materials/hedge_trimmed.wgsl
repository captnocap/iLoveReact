// @material hedge_trimmed
// @slug hedge-trimmed
// @name Trimmed Hedge
// @board environment
// @variant-labels Boxwood Face, Blossom Hedge, Patchy Yellow
// @kind surface
// @tags environment, hedge, garden
// @author fable-botanic
fn hedge_trimmed(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let fine = fbm(uv.x * 26.0 + seed, uv.y * 26.0, 5.0) * 0.5 + 0.5;
  let mid = fbm(uv.x * 6.0 + seed * 1.3, uv.y * 6.0, 4.0) * 0.5 + 0.5;
  var deep = vec3f(0.03, 0.12, 0.05);
  var lit = vec3f(0.19, 0.44, 0.13);
  var accent = vec3f(0.93, 0.62, 0.72);
  var accent_amt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.04, 0.14, 0.07);
    lit = vec3f(0.24, 0.50, 0.20);
    accent_amt = 1.0;
  } else if (variant >= 1.5) {
    deep = vec3f(0.08, 0.12, 0.04);
    lit = vec3f(0.42, 0.48, 0.14);
    accent = vec3f(0.60, 0.52, 0.22);
    accent_amt = 0.6;
  }
  let lightg = 1.05 - uv.y * 0.35;
  var col = mix(deep, lit, fine * 0.6 + mid * 0.4) * lightg;
  let gap = smoothstep(0.38, 0.18, fine) * smoothstep(0.55, 0.30, mid);
  col = mix(col, deep * 0.55, gap);
  let trimline = line_near(sin(uv.y * 44.0 + seed), 0.08);
  col = col + vec3f(0.03, 0.06, 0.02) * trimline;
  let twig = speckle(px, 3.0, seed, 0.955);
  col = mix(col, vec3f(0.38, 0.28, 0.16), twig * 0.7);
  let bloomv = voronoi(uv.x * 20.0 + seed, uv.y * 20.0);
  let bloom = smoothstep(0.12, 0.05, bloomv.x) * step(0.78, fract(bloomv.y * 11.17));
  col = mix(col, accent, bloom * accent_amt);
  let sheen = pow(sat(fine), 4.0);
  col = col + vec3f(0.06, 0.09, 0.04) * sheen * lightg;
  return sat3(col);
}
