// @material typewriter_page
// @slug typewriter-page
// @name Typewriter Page
// @board wallpapers
// @variant-labels Fresh Ribbon, Faded Draft, Red Corrections
// @kind surface
// @tags wallpapers, typewriter, typed, page
// @author fable-paper_print
fn typewriter_page(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.93, 0.92, 0.87);
  var ink = vec3f(0.15, 0.14, 0.16);
  var corr = vec3f(0.70, 0.24, 0.20);
  var fade = 0.85;
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.89, 0.87, 0.79); ink = vec3f(0.34, 0.32, 0.34); fade = 0.6; }
  else if (variant >= 1.5) { paper = vec3f(0.94, 0.93, 0.90); corr = vec3f(0.78, 0.22, 0.20); }
  var col = paper * (0.96 + 0.04 * (fbm(uv.x * 30.0, uv.y * 30.0 + seed, 2.0) + 0.5));
  let rowden = 26.0;
  let row = floor(uv.y * rowden);
  let rl = fract(uv.y * rowden);
  let cx = floor(uv.x * 52.0);
  let charbit = rand(vec2f(row * 17.0 + cx, seed));
  let inmargin = step(0.10, uv.x) * step(uv.x, 0.90) * step(0.08, uv.y) * step(uv.y, 0.92);
  let linelen = 0.90 - rand(vec2f(row, seed + 1.0)) * 0.20;
  let paragap = step(0.12, fract(row * 0.18 + rand(vec2f(row, seed + 2.0)) * 0.05));
  var glyph = step(rl, 0.42) * step(charbit, 0.88) * inmargin * step(uv.x, linelen) * paragap;
  let strike = fract(uv.x * 52.0);
  let punch = step(0.12, strike) * step(strike, 0.88);
  glyph = glyph * punch;
  let jit = (rand(vec2f(row, cx + seed)) - 0.5) * 0.10;
  col = mix(col, ink, glyph * (fade + jit) * (0.85 + 0.15 * (fbm(uv.x * 80.0, uv.y * 80.0 + seed, 2.0) + 0.5)));
  let badrow = step(0.86, rand(vec2f(row, seed + 4.0)));
  let xout = step(rl, 0.46) * badrow * inmargin * step(0.20, uv.x) * step(uv.x, 0.20 + 0.20 + rand(vec2f(row, seed + 5.0)) * 0.15) * paragap;
  col = mix(col, ink, xout * 0.9);
  if (variant >= 1.5) {
    let corrrow = step(0.90, rand(vec2f(row, seed + 6.0)));
    let cmark = step(rl, 0.42) * corrrow * inmargin * step(0.30, uv.x) * step(uv.x, 0.62) * paragap;
    col = mix(col, corr, cmark * 0.85);
    let cnote = line_near(uv.x - 0.94, 0.010) * step(0.2, uv.y) * step(uv.y, 0.5);
    col = mix(col, corr, cnote * 0.6);
  }
  let roller = smoothstep(0.06, 0.0, uv.y) * 0.10;
  col = col - vec3f(roller);
  col = col - vec3f(speckle(px, 2.0, seed + 8.0, 0.992) * 0.08);
  return sat3(col);
}
