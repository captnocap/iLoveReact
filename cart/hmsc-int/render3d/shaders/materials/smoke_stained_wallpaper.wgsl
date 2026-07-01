// @material smoke_stained_wallpaper
// @slug smoke-stained-wallpaper
// @name Smoke-Stained Paper
// @board wallpapers
// @variant-labels Ceiling Fade, Water Leak, Nicotine
// @kind surface
// @tags wallpapers, smoke, stained
// @author legacy
fn smoke_stained_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = wallpaper_base(uv, px, seed, vec3f(0.68, 0.62, 0.48), vec3f(0.46, 0.38, 0.26), vec3f(0.28, 0.20, 0.12), 1.0);
  let soot = smoothstep(0.42, 1.0, uv.y) * (fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5);
  let leak = vertical_drips(uv, seed, 1.0);
  let nic = smoothstep(0.0, 1.0, uv.y);
  if (variant < 0.5) { col = mix(col, vec3f(0.08, 0.07, 0.05), soot * 0.55); }
  else if (variant < 1.5) { col = mix(col, vec3f(0.24, 0.15, 0.08), leak * 0.65); }
  else { col = mix(col, vec3f(0.50, 0.34, 0.16), nic * 0.45); }
  return sat3(col);
}
