// @material peel_wallpaper_vice
// @slug peel-wallpaper
// @name Peel Wallpaper
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, peel, wallpaper
// @author legacy
fn peel_wallpaper_vice(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let stripe = line_near(sin(uv.x * (32.0 + variant * 8.0)), 0.18);
  let flourish = line_near(sin((uv.x * 18.0 + sin(uv.y * 21.0 + seed) * 2.0) + seed), 0.09) * line_near(sin(uv.y * 23.0), 0.13);
  var paper_a = vec3f(0.95, 0.40, 0.66);
  var paper_b = vec3f(0.16, 0.84, 0.86);
  if (variant > 0.5 && variant < 1.5) {
    paper_a = vec3f(0.84, 0.70, 0.25);
    paper_b = vec3f(0.14, 0.62, 0.70);
  } else if (variant >= 1.5) {
    paper_a = vec3f(0.78, 0.52, 0.82);
    paper_b = vec3f(0.13, 0.17, 0.26);
  }
  let age = fbm(uv.x * 7.0 + seed, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(paper_b, paper_a, stripe * 0.55 + flourish * 0.34 + age * 0.20);
  let peel = smoothstep(0.48 - variant * 0.04, 0.67, fbm(uv.x * 5.0 + seed, uv.y * 6.0 - seed, 5.0) * 0.5 + 0.5);
  let curl_edge = line_near(fbm(uv.x * 7.0 + seed, uv.y * 8.0, 4.0) - 0.42, 0.025);
  let plaster = mix(vec3f(0.31, 0.27, 0.22), vec3f(0.65, 0.58, 0.46), age);
  col = mix(col, plaster, peel * 0.72);
  col = mix(col, vec3f(0.95, 0.86, 0.62), curl_edge * peel * 0.45);
  col = mix(col, vec3f(0.025, 0.055, 0.030), blotch(uv, vec2f(0.24, 0.78), 0.18, vec2f(1.4, 0.8), seed) * 0.58);
  return neon_grime(uv, px, col, seed, variant);
}
