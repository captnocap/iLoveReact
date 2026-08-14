// @material birch_bark
// @slug birch-bark
// @name Birch Bark
// @board environment
// @variant-labels Paper White, Aged Grove, Evening Warm
// @kind surface
// @tags environment, birch, bark
// @author fable-botanic
fn birch_bark(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.88, 0.87, 0.82);
  var underlay = vec3f(0.68, 0.64, 0.58);
  var mark = vec3f(0.13, 0.12, 0.11);
  var peel_c = vec3f(0.72, 0.58, 0.48);
  var moss_amt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    paper = vec3f(0.74, 0.74, 0.70);
    underlay = vec3f(0.52, 0.52, 0.48);
    mark = vec3f(0.10, 0.10, 0.09);
    peel_c = vec3f(0.55, 0.46, 0.38);
    moss_amt = 1.0;
  } else if (variant >= 1.5) {
    paper = vec3f(0.92, 0.84, 0.72);
    underlay = vec3f(0.72, 0.58, 0.46);
    mark = vec3f(0.20, 0.13, 0.10);
    peel_c = vec3f(0.80, 0.60, 0.44);
  }
  let streak = fbm(uv.x * 30.0 + seed, uv.y * 3.0, 4.0) * 0.5 + 0.5;
  var col = mix(underlay, paper, smoothstep(0.25, 0.65, streak));
  let lv = voronoi(uv.x * 4.0 + seed * 0.7, uv.y * 26.0 + seed * 0.3);
  let lent = smoothstep(0.30, 0.12, lv.x) * step(0.55, fract(lv.y * 8.13));
  col = mix(col, mark, lent * 0.9);
  let scar = smoothstep(0.20, 0.10, lv.x) * step(0.90, fract(lv.y * 5.43));
  col = mix(col, vec3f(0.30, 0.20, 0.14), scar);
  let peelm = blotch(uv, vec2f(0.3 + fract(seed * 0.37) * 0.4, 0.6), 0.16, vec2f(2.2, 1.0), seed);
  col = mix(col, peel_c, peelm * 0.8);
  let curlline = line_near(sin(uv.y * 120.0 + seed * 2.0), 0.10);
  col = mix(col, col * 0.85, curlline * 0.5);
  let mossm = smoothstep(0.6, 0.85, fbm(uv.x * 7.0 + seed * 2.3, uv.y * 7.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.28, 0.38, 0.16), mossm * moss_amt * 0.7);
  let grain = speckle(px, 2.0, seed + 3.0, 0.96);
  col = mix(col, mark * 1.4, grain * 0.5);
  return sat3(col);
}
