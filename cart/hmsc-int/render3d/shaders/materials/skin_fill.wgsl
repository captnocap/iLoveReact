// @material skin_fill
// @slug skin
// @name Skin
// @board props
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags props, skin
// @author legacy
fn skin_fill(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let mottle = fbm(uv.x * 7.0 + seed, uv.y * 8.0 - seed, 5.0) * 0.5 + 0.5;
  let pore_noise = fbm(uv.x * 42.0 - seed, uv.y * 39.0 + seed, 4.0) * 0.5 + 0.5;
  var low = vec3f(0.70, 0.43, 0.31);
  var high = vec3f(0.98, 0.72, 0.55);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.42, 0.23, 0.16);
    high = vec3f(0.76, 0.48, 0.32);
  } else if (variant >= 1.5) {
    low = vec3f(0.18, 0.095, 0.065);
    high = vec3f(0.44, 0.25, 0.16);
  }
  var col = mix(low, high, mottle * 0.58 + pore_noise * 0.10 + 0.14);
  let pore = speckle(px, 2.2, seed, 0.80) * 0.055;
  let freckle = speckle(px + vec2f(17.0, 31.0), 6.5, seed, 0.965) * smoothstep(0.0, 1.1, 1.2 - variant * 0.25);
  let crease = line_near(snoise(uv.x * 10.0 + seed, uv.y * 15.0 - seed), 0.014) * smoothstep(0.40, 0.86, fbm(uv.x * 4.0, uv.y * 4.0 + seed, 3.0) * 0.5 + 0.5);
  let scar = line_near(uv.y - 0.42 - sin(uv.x * 9.0 + seed) * 0.025, 0.010) * smoothstep(1.0, 1.8, variant);
  col = col - vec3f(pore) - vec3f(0.18, 0.09, 0.04) * freckle;
  col = mix(col, vec3f(0.54, 0.24, 0.18), crease * 0.16);
  col = mix(col, vec3f(0.84, 0.60, 0.48), scar * 0.34);
  return sat3(col);
}
