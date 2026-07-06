// @material ticket_stubs
// @slug ticket-stubs
// @name Ticket Stubs
// @board wallpapers
// @variant-labels Cinema Night, Raffle Reds, Transit Fade
// @kind composition
// @tags wallpapers, tickets, stubs, perforation
// @author fable-paper_print
fn ticket_stubs(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var table = vec3f(0.30, 0.26, 0.24);
  var ca = vec3f(0.86, 0.72, 0.34);
  var cb = vec3f(0.74, 0.30, 0.28);
  var cc = vec3f(0.36, 0.52, 0.62);
  if (variant > 0.5 && variant < 1.5) { table = vec3f(0.24, 0.20, 0.22); ca = vec3f(0.82, 0.28, 0.26); cb = vec3f(0.88, 0.48, 0.30); cc = vec3f(0.78, 0.66, 0.54); }
  else if (variant >= 1.5) { table = vec3f(0.34, 0.34, 0.36); ca = vec3f(0.70, 0.72, 0.68); cb = vec3f(0.56, 0.62, 0.70); cc = vec3f(0.78, 0.74, 0.60); }
  var col = table * (0.9 + 0.1 * (fbm(uv.x * 10.0, uv.y * 10.0 + seed, 3.0) + 0.5));
  for (var i = 0; i < 6; i = i + 1) {
    let fi = f32(i);
    let jx = rand(vec2f(fi * 3.1 + seed, 1.0));
    let jy = rand(vec2f(fi * 5.7, seed + 2.0));
    let x0 = jx * 0.62;
    let y0 = jy * 0.70;
    let w = 0.34;
    let h = 0.16;
    let m = rect_mask(uv, x0, x0 + w, y0, y0 + h, 0.006);
    let sh = rect_mask(uv, x0 + 0.012, x0 + w + 0.012, y0 + 0.014, y0 + h + 0.014, 0.02);
    col = mix(col, table * 0.55, sh * (1.0 - m) * 0.7);
    var tick = ca;
    let pick = rand(vec2f(fi, seed + 6.0));
    if (pick > 0.66) { tick = cb; } else if (pick > 0.33) { tick = cc; }
    col = mix(col, tick, m);
    let lu = (uv - vec2f(x0, y0)) / vec2f(w, h);
    let frame = max(line_near(min(lu.x, 1.0 - lu.x) - 0.06, 0.03), line_near(min(lu.y, 1.0 - lu.y) - 0.10, 0.05));
    col = mix(col, tick * 0.55, frame * m * 0.8);
    let perfx = 0.72;
    let perf = dot_mark(vec2f(fract(lu.y * 7.0), lu.x), vec2f(0.5, perfx), 0.10) * m;
    col = mix(col, table, perf * 0.85);
    let bars = step(fract(lu.y * 4.0), 0.42) * step(0.14, lu.x) * step(lu.x, 0.64) * step(0.25, lu.y) * step(lu.y, 0.78) * m * step(rand(vec2f(floor(lu.y * 4.0) + fi, seed)), 0.85);
    col = mix(col, tick * 0.35, bars * 0.8);
    let starm = dot_mark(lu, vec2f(0.86, 0.5), 0.07) * m;
    col = mix(col, tick * 1.3, starm * 0.7);
  }
  col = col - vec3f(speckle(px, 3.0, seed, 0.99) * 0.10);
  return sat3(col);
}
