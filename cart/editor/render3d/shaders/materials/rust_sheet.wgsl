// @material rust_sheet
// @slug rust-sheet
// @name Rust Sheet
// @board condemned
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags condemned, rust, sheet
// @author legacy
fn rust_sheet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let corr = sin(uv.x * (55.0 + variant * 16.0));
  let ridge = corr * 0.5 + 0.5;
  var metal = mix(vec3f(0.25, 0.27, 0.26), vec3f(0.61, 0.62, 0.57), ridge * 0.45 + 0.25);
  metal = metal + vec3f((fbm(uv.x * 18.0 + seed, uv.y * 18.0, 4.0) * 0.5 - 0.25) * 0.11);
  let rust_noise = fbm(uv.x * 8.0 + seed, uv.y * 8.0 - seed, 5.0) * 0.5 + 0.5;
  let rust = smoothstep(0.45 - variant * 0.05, 0.76, rust_noise);
  var col = mix(metal, mix(vec3f(0.26, 0.08, 0.025), vec3f(0.78, 0.30, 0.065), rust_noise), rust * 0.85);
  col = mix(col, vec3f(0.64, 0.18, 0.035), vertical_drips(uv, seed + 3.0, variant + 1.0) * 0.55);
  col = mix(col, vec3f(0.055, 0.050, 0.042), speckle(px, 5.5, seed, 0.94) * rust * 0.72);
  return sat3(col - vec3f(line_near(corr, 0.030) * 0.08));
}
