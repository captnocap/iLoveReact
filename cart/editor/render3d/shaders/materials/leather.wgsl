// @material leather
// @slug leather
// @name Leather
// @board props
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags props, leather
// @author legacy
fn leather(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let pore = fbm(uv.x * 30.0 + seed, uv.y * 26.0 - seed, 5.0) * 0.5 + 0.5;
  let wrinkle = line_near(snoise(uv.x * 8.0 + seed, uv.y * 19.0 - seed), 0.022);
  var low = vec3f(0.17, 0.075, 0.030);
  var high = vec3f(0.58, 0.28, 0.11);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.030, 0.026, 0.022);
    high = vec3f(0.24, 0.21, 0.17);
  } else if (variant >= 1.5) {
    low = vec3f(0.42, 0.25, 0.12);
    high = vec3f(0.78, 0.52, 0.25);
  }
  var col = mix(low, high, pore * 0.58 + 0.20);
  let crease = line_near(snoise(uv.x * 13.0 - seed, uv.y * 9.0 + seed), 0.018);
  let seam = line_near(uv.x - 0.18, 0.010) * smoothstep(0.25, 0.85, uv.y);
  let stitch = seam * step(0.55, fract(uv.y * 18.0 + variant * 0.3));
  col = col - vec3f(0.16, 0.10, 0.06) * wrinkle - vec3f(0.12, 0.075, 0.040) * crease;
  col = mix(col, vec3f(0.86, 0.69, 0.48), stitch * 0.72);
  col = mix(col, vec3f(0.95, 0.72, 0.38), speckle(px, 6.0, seed, 0.95) * smoothstep(1.0, 1.8, variant) * 0.40);
  return sat3(col);
}
