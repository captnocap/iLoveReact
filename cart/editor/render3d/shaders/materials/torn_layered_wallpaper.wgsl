// @material torn_layered_wallpaper
// @slug torn-layered-wallpaper
// @name Torn Layered Paper
// @board wallpapers
// @variant-labels Old Floral, Plaster Reveal, Many Layers
// @kind surface
// @tags wallpapers, torn, layered
// @author legacy
fn torn_layered_wallpaper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var top_paper = floral_wallpaper(uv, px, 0.0, seed);
  var under_paper = stripe_wallpaper(uv + vec2f(0.08, 0.03), px, 1.0, seed + 5.0);
  var plaster = vec3f(0.56, 0.50, 0.42) + vec3f((fbm(uv.x * 16.0, uv.y * 16.0 + seed, 4.0) - 0.5) * 0.08);
  if (variant > 0.5 && variant < 1.5) {
    top_paper = damask_wallpaper(uv, px, 1.0, seed);
    under_paper = wallpaper_base(uv, px, seed, vec3f(0.64, 0.56, 0.44), vec3f(0.22, 0.18, 0.12), vec3f(0.42, 0.28, 0.18), 0.0);
  } else if (variant >= 1.5) {
    top_paper = rose_trellis_wallpaper(uv, px, 2.0, seed);
    under_paper = motel_wallpaper(uv, px, 2.0, seed + 9.0);
    plaster = vec3f(0.44, 0.38, 0.30) + vec3f((fbm(uv.x * 18.0, uv.y * 18.0 + seed, 4.0) - 0.5) * 0.08);
  }
  let tear_a = smoothstep(0.46, 0.62, fbm(uv.x * 4.0 + seed, uv.y * 5.0, 5.0) * 0.5 + 0.5);
  let tear_b = smoothstep(0.52, 0.70, fbm(uv.x * 7.0 - seed, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
  var col = mix(top_paper, under_paper, tear_a * 0.72);
  col = mix(col, plaster, tear_b * 0.45);
  col = mix(col, vec3f(0.20, 0.14, 0.08), vertical_drips(uv, seed, 1.0) * 0.26);
  return sat3(col);
}
