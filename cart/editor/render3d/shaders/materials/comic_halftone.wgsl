// @material comic_halftone
// @slug comic-halftone
// @name Comic Halftone
// @board wallpapers
// @variant-labels Pulp Red, Cyan Pop, Noir Panel
// @kind surface
// @tags wallpapers, comic, halftone, dots
// @author fable-paper_print
fn comic_halftone(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.93, 0.89, 0.80);
  var dotc = vec3f(0.80, 0.22, 0.18);
  var altc = vec3f(0.92, 0.72, 0.16);
  var ink = vec3f(0.12, 0.10, 0.13);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.90, 0.93, 0.92); dotc = vec3f(0.16, 0.62, 0.78); altc = vec3f(0.86, 0.32, 0.58); }
  else if (variant >= 1.5) { paper = vec3f(0.78, 0.77, 0.74); dotc = vec3f(0.28, 0.28, 0.32); altc = vec3f(0.62, 0.14, 0.14); ink = vec3f(0.05, 0.05, 0.07); }
  let pan = floor(uv * 2.0);
  let pid = pan.x + pan.y * 2.0;
  let lp = fract(uv * 2.0);
  var col = paper * (0.95 + 0.05 * (fbm(uv.x * 20.0, uv.y * 20.0 + seed, 3.0) + 0.5));
  let pick = rand(vec2f(pid + seed, seed * 0.7));
  var dsz = 6.0 + floor(pick * 3.0) * 3.0;
  let cell = fract(px / dsz) - vec2f(0.5, 0.5);
  let grade = 0.20 + 0.45 * (fbm(uv.x * 3.0 + pid, uv.y * 3.0 + seed, 2.0) + 0.5);
  let dotmask = 1.0 - smoothstep(grade - 0.08, grade + 0.08, length(cell));
  var tint = dotc;
  if (pick > 0.5) { tint = altc; }
  col = mix(col, tint, dotmask * 0.85);
  let border = max(line_near(min(lp.x, 1.0 - lp.x) - 0.02, 0.02), line_near(min(lp.y, 1.0 - lp.y) - 0.02, 0.02));
  col = mix(col, ink, border);
  let burst = step(0.75, rand(vec2f(pid + 4.0, seed)));
  let bc = vec2f(0.5, 0.5) + vec2f(rand(vec2f(pid, seed + 2.0)) - 0.5, rand(vec2f(pid, seed + 5.0)) - 0.5) * 0.3;
  let ang = atan2(lp.y - bc.y, lp.x - bc.x);
  let rays = line_near(sin(ang * 9.0 + seed), 0.10) * smoothstep(0.34, 0.10, length(lp - bc));
  col = mix(col, ink, rays * burst * 0.9);
  col = col - vec3f(speckle(px, 3.0, seed, 0.985) * 0.2);
  return sat3(col);
}
