// @material tropical_wallpaper
// @slug tropical-wallpaper
// @name Tropical Wallpaper
// @board wallpapers
// @variant-labels Palm Green, Pink Flamingo, Night Jungle
// @kind surface
// @tags wallpapers, tropical, wallpaper
// @author legacy
fn tropical_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.14, 0.38, 0.24);
  var leaf = vec3f(0.42, 0.72, 0.22);
  var accent = vec3f(0.94, 0.50, 0.58);
  if (variant > 0.5 && variant < 1.5) { bg = vec3f(0.72, 0.42, 0.50); leaf = vec3f(0.16, 0.46, 0.24); accent = vec3f(0.98, 0.72, 0.80); }
  else if (variant >= 1.5) { bg = vec3f(0.02, 0.04, 0.03); leaf = vec3f(0.08, 0.32, 0.12); accent = vec3f(0.78, 0.18, 0.38); }
  var col = bg + vec3f((fbm(uv.x * 15.0 + seed, uv.y * 15.0, 5.0) - 0.5) * 0.05);
  let repeat = fract(uv * vec2f(4.0, 5.0)) - vec2f(0.5, 0.5);
  let frond = line_near(abs(repeat.x) - (0.08 + abs(repeat.y) * 0.34), 0.045) * smoothstep(0.48, 0.05, abs(repeat.y));
  let vein = line_near(repeat.x, 0.012) * smoothstep(0.48, 0.02, abs(repeat.y));
  let flower = 1.0 - smoothstep(0.06, 0.10, length((fract(uv * vec2f(3.0, 3.0)) - vec2f(0.65, 0.35)) * vec2f(1.0, 1.0)));
  col = mix(col, leaf, frond * 0.75);
  col = mix(col, leaf * 0.45, vein * 0.70);
  col = mix(col, accent, flower * 0.62);
  return sat3(col);
}
