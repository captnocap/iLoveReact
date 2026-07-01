// @material rose_trellis_wallpaper
// @slug rose-trellis-wallpaper
// @name Rose Trellis
// @board wallpapers
// @variant-labels Dusty Rose, Sage Garden, Blue Parlor
// @kind surface
// @tags wallpapers, rose, trellis
// @author legacy
fn rose_trellis_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.76, 0.62, 0.58);
  var rose = vec3f(0.78, 0.18, 0.30);
  var leaf = vec3f(0.20, 0.36, 0.18);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.58, 0.68, 0.48); rose = vec3f(0.94, 0.72, 0.48); leaf = vec3f(0.12, 0.30, 0.12); }
  else if (variant >= 1.5) { bg = vec3f(0.62, 0.70, 0.78); rose = vec3f(0.12, 0.30, 0.64); leaf = vec3f(0.72, 0.64, 0.32); }
  var col = bg + vec3f((fbm(uv.x * 18.0 + seed, uv.y * 18.0, 4.0) - 0.5) * 0.045);
  let trellis_a = line_near(fract((uv.x + uv.y) * 5.0) - 0.5, 0.035);
  let trellis_b = line_near(fract((uv.x - uv.y) * 5.0) - 0.5, 0.035);
  col = mix(col, bg * 0.68, max(trellis_a, trellis_b) * 0.42);
  let repeat = uv * vec2f(4.0, 5.0);
  let cell = floor(repeat);
  let l = fract(repeat) - vec2f(0.5, 0.5);
  let bloom = 1.0 - smoothstep(0.13, 0.22, length(l * vec2f(1.0, 1.2)));
  let petal = line_near(sin(atan2(l.y, l.x) * 5.0 + length(l) * 30.0), 0.18) * bloom;
  let leaf_mark = line_near(abs(l.x) + abs(l.y) - 0.30, 0.035) * step(0.35, rand(cell + vec2f(seed, seed)));
  col = mix(col, leaf, leaf_mark * 0.48);
  col = mix(col, rose, petal * 0.78);
  return sat3(col);
}
