// @material postage_stamps
// @slug postage-stamps
// @name Postage Stamps
// @board wallpapers
// @variant-labels Warm Commemoratives, Cool Airpost, Antique Sheet
// @kind surface
// @tags wallpapers, stamps, postage, perforated
// @author fable-paper_print
fn postage_stamps(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var backing = vec3f(0.92, 0.90, 0.84);
  var ca = vec3f(0.76, 0.30, 0.24);
  var cb = vec3f(0.86, 0.60, 0.22);
  var cd = vec3f(0.38, 0.56, 0.40);
  if (variant > 0.5 && variant < 1.5) { ca = vec3f(0.28, 0.44, 0.66); cb = vec3f(0.36, 0.60, 0.64); cd = vec3f(0.50, 0.42, 0.66); }
  else if (variant >= 1.5) { backing = vec3f(0.84, 0.78, 0.64); ca = vec3f(0.54, 0.40, 0.30); cb = vec3f(0.48, 0.50, 0.38); cd = vec3f(0.58, 0.32, 0.30); }
  var col = backing * (0.96 + 0.04 * (fbm(uv.x * 24.0, uv.y * 24.0 + seed, 2.0) + 0.5));
  let g = vec2f(3.0, 3.0);
  let cellid = floor(uv * g);
  let lc = fract(uv * g);
  let edge = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  let perf = dot_mark(vec2f(fract(lc.x * 9.0), fract(lc.y * 9.0)), vec2f(0.5, 0.5), 0.22);
  let onedge = step(edge, 0.045);
  col = mix(col, backing * 0.78, perf * onedge);
  let inner = step(0.045, edge);
  var stampc = ca;
  let pick = rand(vec2f(cellid.x + cellid.y * 3.0, seed));
  if (pick > 0.66) { stampc = cb; } else if (pick > 0.33) { stampc = cd; }
  col = mix(col, stampc, inner * 0.92);
  let frame = line_near(edge - 0.10, 0.02);
  col = mix(col, backing, frame * inner * 0.85);
  let mc = vec2f(0.5, 0.44);
  let motif = smoothstep(0.20, 0.16, length((lc - mc) * vec2f(1.0, 1.3)));
  col = mix(col, stampc * 0.55, motif * inner);
  let peak = line_near(abs(lc.x - 0.5) * 0.8 + (lc.y - 0.36), 0.03) * step(0.30, lc.y) * step(lc.y, 0.50);
  col = mix(col, stampc * 1.35, peak * inner * motif);
  let denom = rect_mask(lc, 0.62, 0.84, 0.66, 0.82, 0.01);
  col = mix(col, backing, denom * inner * 0.85);
  let dbar = step(fract(lc.x * 20.0), 0.5) * denom * inner;
  col = mix(col, stampc * 0.5, dbar * 0.7);
  if (variant >= 1.5) {
    let cancel = line_near(length(uv - vec2f(0.3 + rand(vec2f(seed, 3.0)) * 0.4, 0.3 + rand(vec2f(seed, 4.0)) * 0.4)) - 0.16, 0.012);
    col = mix(col, vec3f(0.20, 0.20, 0.24), cancel * 0.55);
    col = col - vec3f(speckle(px, 3.0, seed, 0.985) * 0.14);
  }
  return sat3(col);
}
