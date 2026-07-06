// @material sheet_music
// @slug sheet-music
// @name Sheet Music
// @board wallpapers
// @variant-labels Ivory Score, Sepia Hymnal, Chalk Slate
// @kind surface
// @tags wallpapers, music, staves, notes
// @author fable-paper_print
fn sheet_music(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paper = vec3f(0.94, 0.93, 0.88);
  var ink = vec3f(0.16, 0.15, 0.18);
  if (variant > 0.5 && variant < 1.5) { paper = vec3f(0.86, 0.79, 0.62); ink = vec3f(0.30, 0.23, 0.16); }
  else if (variant >= 1.5) { paper = vec3f(0.16, 0.19, 0.20); ink = vec3f(0.86, 0.87, 0.84); }
  var col = paper * (0.96 + 0.04 * (fbm(uv.x * 26.0, uv.y * 26.0 + seed, 2.0) + 0.5));
  let nsys = 3.0;
  let sys = floor(uv.y * nsys);
  let sy = fract(uv.y * nsys);
  let instaff = step(0.25, sy) * step(sy, 0.75);
  let staffline = line_near(fract((sy - 0.25) * 8.0) - 0.0, 0.06) * instaff * step(fract((sy - 0.25) * 2.0), 0.999);
  let sline = line_near(fract(sy * 8.0 + 0.5) - 0.5, 0.055) * instaff;
  col = mix(col, ink, sline * 0.7 * step(0.06, uv.x) * step(uv.x, 0.94));
  let barx = fract(uv.x * 4.0);
  let barline = line_near(barx - 0.02, 0.012) * instaff * step(0.06, uv.x) * step(uv.x, 0.94);
  col = mix(col, ink, barline * 0.7);
  for (var i = 0; i < 8; i = i + 1) {
    let fi = f32(i);
    let nx = 0.10 + fi * 0.105 + rand(vec2f(fi + sys * 8.0, seed)) * 0.04;
    let pitch = floor(rand(vec2f(fi * 3.0 + sys, seed + 2.0)) * 8.0);
    let ny = (sys + 0.25 + pitch * 0.0625) / nsys;
    let head = smoothstep(0.013, 0.008, length((uv - vec2f(nx, ny)) * vec2f(1.0, 1.4)));
    col = mix(col, ink, head * 0.9);
    let stem = segment_mark(uv, vec2f(nx + 0.009, ny), vec2f(nx + 0.009, ny - 0.045), 0.0028);
    col = mix(col, ink, stem * 0.85);
    let flag = step(0.6, rand(vec2f(fi + sys, seed + 4.0)));
    let fmark = segment_mark(uv, vec2f(nx + 0.009, ny - 0.045), vec2f(nx + 0.024, ny - 0.032), 0.0028) * flag;
    col = mix(col, ink, fmark * 0.8);
  }
  let clef = line_near(length((uv - vec2f(0.055, (sys + 0.5) / nsys)) * vec2f(1.4, 1.0)) - 0.030, 0.010) * instaff;
  col = mix(col, ink, clef * 0.8);
  let title = step(fract(uv.y * 26.0), 0.45) * step(uv.y, 0.06) * step(0.34, uv.x) * step(uv.x, 0.66);
  col = mix(col, ink, title * 0.7);
  col = col - vec3f(speckle(px, 3.0, seed + 1.0, 0.992) * 0.08);
  return sat3(col);
}
