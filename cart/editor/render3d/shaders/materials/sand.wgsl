// @material sand
// @slug sand
// @name Sand
// @board environment
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags environment, sand
// @author legacy
fn sand(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let dune_warp = fbm(uv.x * 3.0 + seed, uv.y * 2.0 - seed, 4.0);
  let ripple = line_near(sin(uv.y * (34.0 + variant * 5.0) + uv.x * (9.0 - variant * 2.0) + dune_warp * 4.0), 0.055 + variant * 0.012);
  let noise = fbm(uv.x * 20.0, uv.y * 20.0 + seed, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.66, 0.50, 0.30), vec3f(0.90, 0.76, 0.48), noise);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.43, 0.34, 0.24), smoothstep(0.20, 0.88, uv.y) * 0.48);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.80, 0.57, 0.30), 0.36);
  }
  col = col + vec3f(0.12, 0.10, 0.06) * ripple;
  col = col + vec3f(0.09, 0.075, 0.045) * speckle(px, 1.8, seed, 0.72) - vec3f(0.10, 0.075, 0.045) * speckle(px + vec2f(5.0, 13.0), 2.6, seed, 0.82);
  return sat3(col);
}
