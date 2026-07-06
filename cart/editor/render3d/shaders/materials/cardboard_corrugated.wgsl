// @material cardboard_corrugated
// @slug cardboard-corrugated
// @name Corrugated Cardboard
// @board wallpapers
// @variant-labels Shipping Face, Cut Flute Edge, Stenciled Box
// @kind surface
// @tags wallpapers, cardboard, corrugated, box
// @author fable-paper_print
fn cardboard_corrugated(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let tan1 = vec3f(0.72, 0.55, 0.35);
  let tan2 = vec3f(0.55, 0.41, 0.26);
  let inkc = vec3f(0.22, 0.20, 0.24);
  let tapec = vec3f(0.66, 0.60, 0.46);
  let wash = fbm(uv.x * 8.0 + seed * 0.4, uv.y * 8.0, 3.0) + 0.5;
  var col = mix(tan2, tan1, sat(0.35 + wash * 0.5));
  let flute = sin(uv.x * 140.0 + seed) * 0.5 + 0.5;
  col = mix(col, tan2, flute * 0.10);
  let fiber = fbm(uv.x * 60.0, uv.y * 60.0 + seed, 2.0) + 0.5;
  col = mix(col, tan1, fiber * 0.12);
  if (variant > 0.5 && variant < 1.5) {
    let band = step(0.38, uv.y) * step(uv.y, 0.62);
    let wave = sin(uv.x * 90.0 + seed) * 0.06;
    let mid = 0.5 + wave;
    let flutewall = line_near(uv.y - mid, 0.035) * band;
    let liner = max(line_near(uv.y - 0.40, 0.015), line_near(uv.y - 0.60, 0.015));
    col = mix(col, tan2 * 0.72, band * 0.45);
    col = mix(col, tan1 * 1.1, flutewall);
    col = mix(col, tan2 * 0.6, liner);
  } else if (variant >= 1.5) {
    let sx = fract(uv.x * 1.0) - 0.5;
    let arrow = line_near(abs(sx) + (uv.y - 0.30) * 0.7 - 0.10, 0.02) * step(0.18, uv.y) * step(uv.y, 0.34);
    let stem = line_near(sx, 0.025) * step(0.32, uv.y) * step(uv.y, 0.46);
    let bars = step(fract(uv.y * 12.0), 0.5) * step(0.60, uv.y) * step(uv.y, 0.78) * step(0.25, uv.x) * step(uv.x, 0.75) * step(rand(vec2f(floor(uv.y * 12.0), seed)), 0.8);
    col = mix(col, inkc, sat(arrow + stem) * 0.75);
    col = mix(col, inkc, bars * 0.6);
  } else {
    let tape = step(0.44, uv.x) * step(uv.x, 0.58);
    col = mix(col, tapec, tape * 0.65);
    col = mix(col, tan2, max(line_near(uv.x - 0.44, 0.008), line_near(uv.x - 0.58, 0.008)) * 0.5);
    let labelm = rect_mask(uv, 0.64, 0.90, 0.10, 0.30, 0.01);
    col = mix(col, vec3f(0.90, 0.89, 0.84), labelm * 0.9);
    let lrow = step(fract(uv.y * 24.0), 0.45) * labelm * step(rand(vec2f(floor(uv.y * 24.0), seed + 3.0)), 0.75);
    col = mix(col, inkc, lrow * 0.6 * rect_mask(uv, 0.66, 0.88, 0.12, 0.28, 0.005));
  }
  let scuff = blotch(uv, vec2f(rand(vec2f(seed, 9.0)), 0.85), 0.16, vec2f(1.6, 1.6), seed) * 0.15;
  col = col - vec3f(scuff);
  col = col - vec3f(speckle(px, 3.0, seed + 1.0, 0.985) * 0.12);
  return sat3(col);
}
