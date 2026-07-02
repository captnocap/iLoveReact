// @material road
// @slug road
// @name Road
// @board environment
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags environment, road
// @author legacy
fn road(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let coarse = fbm(uv.x * 18.0 + seed, uv.y * 18.0 - seed, 5.0) * 0.5 + 0.5;
  let tar = fbm(uv.x * 5.0 - seed * 0.4, uv.y * 11.0 + seed * 0.3, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.030, 0.033, 0.034), vec3f(0.125, 0.128, 0.122), coarse);
  col = mix(col, vec3f(0.012, 0.014, 0.015), smoothstep(0.72, 0.98, tar) * 0.38);
  col = col + vec3f(0.13, 0.13, 0.12) * speckle(px, 2.4, seed, 0.948);
  col = col - vec3f(0.045, 0.043, 0.040) * speckle(px + vec2f(19.0, 7.0), 3.5, seed, 0.955);
  col = col - vec3f(0.055, 0.054, 0.052) * crack_field(uv, seed, 8.0);
  if (variant < 0.5) {
    let dash = step(0.38, fract(uv.y * 5.0 + 0.08));
    let stripe = line_near(uv.x - 0.50 + snoise(uv.y * 2.0, seed) * 0.010, 0.022) * dash;
    col = mix(col, vec3f(0.96, 0.74, 0.26), stripe * 0.90);
  } else if (variant < 1.5) {
    let side = line_near(uv.x - 0.18, 0.012) + line_near(uv.x - 0.82, 0.012);
    col = mix(col, vec3f(0.78, 0.80, 0.75), sat(side) * 0.62);
  } else {
    let tar_patch = smoothstep(0.54, 0.63, fbm(uv.x * 6.0 + 8.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
    col = mix(col, vec3f(0.018, 0.020, 0.021), tar_patch * 0.36);
  }
  return sat3(col);
}
