// @material legal_pad
// @slug legal-pad
// @name Legal Pad
// @board wallpapers
// @variant-labels Canary Yellow, White Brief, Goldenrod Worn
// @kind surface
// @tags wallpapers, legal, pad, ruled
// @author fable-paper_print
fn legal_pad(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.93, 0.86, 0.50);
  var rulec = vec3f(0.44, 0.56, 0.80);
  var marginc = vec3f(0.80, 0.36, 0.34);
  var ink = vec3f(0.14, 0.16, 0.30);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.93, 0.92, 0.88); rulec = vec3f(0.58, 0.66, 0.84); ink = vec3f(0.18, 0.18, 0.22); }
  else if (variant >= 1.5) { paper = vec3f(0.85, 0.72, 0.36); rulec = vec3f(0.40, 0.46, 0.62); ink = vec3f(0.24, 0.20, 0.28); }
  var col = paper * (0.95 + 0.05 * (fbm(uv.x * 26.0, uv.y * 26.0 + seed, 2.0) + 0.5));
  let glue = smoothstep(0.085, 0.0, uv.y);
  col = col * (1.0 - glue * 0.22);
  let bind = line_near(uv.y - 0.085, 0.008);
  col = mix(col, ink, bind * 0.4);
  let rules = line_near(fract(uv.y * 16.0 + 0.4) - 0.5, 0.03) * step(0.13, uv.y);
  col = mix(col, rulec, rules * 0.6);
  let m1 = line_near(uv.x - 0.11, 0.009);
  let m2 = line_near(uv.x - 0.135, 0.009);
  col = mix(col, marginc, sat(m1 + m2) * 0.75);
  let row = floor(uv.y * 16.0 + 0.4 - 0.5);
  let slant = (uv.x - 0.15) * 0.015;
  let baseline = (row + 0.85) / 16.0 - 0.025 + slant + sin(uv.x * 45.0 + row * 5.0 + seed) * 0.005;
  let wordbit = rand(vec2f(row * 11.0 + floor(uv.x * 18.0), seed + 1.0));
  let rowon = step(rand(vec2f(row, seed + 7.0)), 0.85);
  let writing = line_near(uv.y - baseline, 0.011) * step(wordbit, 0.68) * rowon * step(0.16, uv.x) * step(uv.x, 0.90) * step(0.13, uv.y);
  col = mix(col, ink, writing * 0.75);
  let under = line_near(uv.y - (floor(rand(vec2f(seed, 12.0)) * 10.0 + 4.0) + 0.98) / 16.0, 0.009) * step(0.18, uv.x) * step(uv.x, 0.55);
  col = mix(col, marginc, under * 0.7);
  if (variant >= 1.5) {
    let curlsh = smoothstep(0.88, 1.0, uv.y) * 0.18 + smoothstep(0.90, 1.0, uv.x) * 0.10;
    col = col * (1.0 - curlsh);
    col = col - vec3f(speckle(px, 3.0, seed + 5.0, 0.988) * 0.15);
  }
  return sat3(col);
}
