// @material security_envelope
// @slug security-envelope
// @name Security Envelope
// @board wallpapers
// @variant-labels Blue Crosshatch, Wavy Tint, Gray Diamond
// @kind surface
// @tags wallpapers, envelope, hatch, mail
// @author fable-paper_print
fn security_envelope(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.94, 0.94, 0.91);
  var inkc = vec3f(0.28, 0.38, 0.68);
  if (variant > 0.5 && variant < 1.5) { inkc = vec3f(0.30, 0.52, 0.66); paper = vec3f(0.92, 0.94, 0.94); }
  else if (variant >= 1.5) { inkc = vec3f(0.42, 0.44, 0.50); paper = vec3f(0.93, 0.92, 0.89); }
  var col = paper * (0.97 + 0.03 * (fbm(uv.x * 30.0, uv.y * 30.0 + seed, 2.0) + 0.5));
  var patt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    let wob = sin(uv.x * 24.0 + seed) * 0.012;
    patt = step(fract((uv.y + wob) * 44.0), 0.45);
    let rowid = floor((uv.y + wob) * 44.0);
    patt = patt * step(0.15, rand(vec2f(rowid, seed)));
  } else if (variant >= 1.5) {
    let da = fract((uv.x + uv.y) * 30.0 + seed * 0.1);
    let db = fract((uv.x - uv.y) * 30.0);
    patt = step(0.5, da) * step(0.5, db) + step(da, 0.5) * step(db, 0.5);
    patt = patt * 0.85;
  } else {
    let a1 = line_near(fract((uv.x + uv.y) * 26.0 + seed * 0.07) - 0.5, 0.16);
    let a2 = line_near(fract((uv.x - uv.y) * 26.0) - 0.5, 0.16);
    patt = sat(a1 + a2);
  }
  col = mix(col, inkc, patt * 0.62);
  let foldy = 0.30 + rand(vec2f(seed, 2.0)) * 0.3;
  let fold = line_near(uv.y - foldy, 0.006);
  col = mix(col, paper * 1.06, fold * 0.7);
  col = mix(col, inkc * 0.7, line_near(uv.y - foldy - 0.010, 0.005) * 0.35);
  let winm = rect_mask(uv, 0.12, 0.52, 0.62, 0.82, 0.008);
  col = mix(col, vec3f(0.82, 0.85, 0.86), winm * 0.9);
  let addr = step(fract(uv.y * 26.0), 0.4) * winm * step(rand(vec2f(floor(uv.y * 26.0), seed + 4.0)), 0.7) * rect_mask(uv, 0.15, 0.48, 0.64, 0.80, 0.004);
  col = mix(col, vec3f(0.24, 0.24, 0.28), addr * 0.65);
  col = col - vec3f(speckle(px, 2.0, seed + 1.0, 0.992) * 0.10);
  return sat3(col);
}
