// @material corkboard
// @slug corkboard
// @name Corkboard
// @board contraband
// @variant-labels Bare, Photos, Red String
// @kind surface
// @tags contraband, corkboard
// @author legacy
fn corkboard(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // The "AI playing Clue" investigation board. 0 bare cork, 1 taped photos,
  // 2 photos + red string + pins (the Case visualised).
  var col = mix(vec3f(0.52, 0.38, 0.20), vec3f(0.72, 0.56, 0.34), fbm(uv.x * 20.0 + seed, uv.y * 20.0, 5.0) * 0.5 + 0.5);
  col = col - vec3f(0.10, 0.10, 0.10) * speckle(px, 1.8, seed, 0.55);
  if (variant < 0.5) { return sat3(col); }
  let p1 = step(0.10, uv.x) * step(uv.x, 0.34) * step(0.18, uv.y) * step(uv.y, 0.46);
  let p2 = step(0.60, uv.x) * step(uv.x, 0.86) * step(0.30, uv.y) * step(uv.y, 0.60);
  let p3 = step(0.34, uv.x) * step(uv.x, 0.58) * step(0.58, uv.y) * step(uv.y, 0.84);
  let photo = sat(p1 + p2 + p3);
  let pimg = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 4.0) * 0.5 + 0.5;
  col = mix(col, mix(vec3f(0.20, 0.22, 0.26), vec3f(0.62, 0.64, 0.68), pimg), photo * 0.92);
  if (variant >= 1.5) {
    let s1 = segment_mark(uv, vec2f(0.22, 0.32), vec2f(0.73, 0.45), 0.006);
    let s2 = segment_mark(uv, vec2f(0.73, 0.45), vec2f(0.46, 0.71), 0.006);
    let s3 = segment_mark(uv, vec2f(0.46, 0.71), vec2f(0.22, 0.32), 0.006);
    col = mix(col, vec3f(0.86, 0.06, 0.10), sat(s1 + s2 + s3) * 0.85);
    let pins = sat(dot_mark(uv, vec2f(0.22, 0.32), 0.02) + dot_mark(uv, vec2f(0.73, 0.45), 0.02) + dot_mark(uv, vec2f(0.46, 0.71), 0.02));
    col = mix(col, vec3f(0.95, 0.2, 0.2), pins);
  }
  return sat3(col);
}
