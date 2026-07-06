// @material airmail_border
// @slug airmail-border
// @name Airmail Border
// @board wallpapers
// @variant-labels Par Avion, Aged Envelope, Night Express
// @kind composition
// @tags wallpapers, airmail, envelope, chevron
// @author fable-paper_print
fn airmail_border(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.93, 0.92, 0.87);
  var redc = vec3f(0.78, 0.24, 0.22);
  var bluec = vec3f(0.22, 0.32, 0.62);
  var inkc = vec3f(0.22, 0.22, 0.28);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.87, 0.82, 0.68); redc = vec3f(0.66, 0.28, 0.24); bluec = vec3f(0.30, 0.36, 0.52); inkc = vec3f(0.32, 0.28, 0.28); }
  else if (variant >= 1.5) { paper = vec3f(0.16, 0.17, 0.24); redc = vec3f(0.82, 0.30, 0.30); bluec = vec3f(0.36, 0.52, 0.86); inkc = vec3f(0.80, 0.80, 0.84); }
  var col = paper * (0.96 + 0.04 * (fbm(uv.x * 20.0, uv.y * 20.0 + seed, 2.0) + 0.5));
  let ed = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let band = step(ed, 0.10) * step(0.015, ed);
  let stripe = floor(fract((uv.x + uv.y) * 9.0 + seed * 0.05) * 2.0);
  var bandc = redc;
  if (stripe > 0.5) { bandc = bluec; }
  col = mix(col, bandc, band * 0.92);
  col = mix(col, paper, step(ed, 0.015) * 0.6);
  col = mix(col, inkc * 0.6, line_near(ed - 0.10, 0.008) * 0.5);
  let arow = floor((uv.y - 0.40) * 14.0);
  let addr = step(fract((uv.y - 0.40) * 14.0), 0.35) * step(0.40, uv.y) * step(uv.y, 0.68) * step(0.26, uv.x) * step(uv.x, 0.26 + 0.30 + rand(vec2f(arow, seed)) * 0.18);
  col = mix(col, inkc, addr * 0.8);
  let stamp = rect_mask(uv, 0.70, 0.86, 0.14, 0.30, 0.006);
  col = mix(col, mix(redc, bluec, step(0.5, rand(vec2f(seed, 5.0)))), stamp * 0.85);
  let slc = fract((uv - vec2f(0.70, 0.14)) / vec2f(0.16, 0.16) * 1.0);
  let sframe = max(line_near(min(slc.x, 1.0 - slc.x) - 0.10, 0.05), line_near(min(slc.y, 1.0 - slc.y) - 0.10, 0.05)) * stamp;
  col = mix(col, paper, sframe * 0.8);
  let pm = line_near(length(uv - vec2f(0.62, 0.22)) - 0.085, 0.010) + line_near(length(uv - vec2f(0.62, 0.22)) - 0.055, 0.008);
  col = mix(col, inkc, sat(pm) * 0.55);
  let wavy = line_near(uv.y - 0.22 - 0.015 * sin(uv.x * 70.0 + seed), 0.006) * step(0.30, uv.x) * step(uv.x, 0.56);
  col = mix(col, inkc, wavy * 0.5);
  col = col - vec3f(speckle(px, 3.0, seed + 2.0, 0.99) * 0.10);
  return sat3(col);
}
