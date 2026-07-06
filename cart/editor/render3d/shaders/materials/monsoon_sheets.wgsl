// @material monsoon_sheets
// @slug monsoon-sheets
// @name Monsoon Sheets
// @board environment
// @variant-labels Green Deluge, Night Wall, Flash Lit
// @kind gradient
// @tags environment, monsoon, rain
// @author fable-water_weather
fn monsoon_sheets(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var back_hi = vec3f(0.24, 0.30, 0.28);
  var back_lo = vec3f(0.10, 0.14, 0.13);
  var sheet_tone = vec3f(0.62, 0.70, 0.72);
  var glowc = vec3f(0.80, 0.86, 0.82);
  if (variant > 0.5 && variant < 1.5) {
    back_hi = vec3f(0.08, 0.09, 0.14);
    back_lo = vec3f(0.03, 0.03, 0.06);
    sheet_tone = vec3f(0.30, 0.34, 0.44);
    glowc = vec3f(0.42, 0.46, 0.58);
  } else if (variant >= 1.5) {
    back_hi = vec3f(0.30, 0.30, 0.40);
    back_lo = vec3f(0.12, 0.11, 0.18);
    sheet_tone = vec3f(0.82, 0.84, 0.94);
    glowc = vec3f(0.96, 0.94, 1.0);
  }
  var col = mix(back_hi, back_lo, uv.y);
  for (var i = 0; i < 4; i = i + 1) {
    let fi = f32(i);
    let drift = rand(vec2f(fi, seed)) * 4.0;
    let curtain = fbm(uv.x * (2.0 + fi) + drift + seed, uv.y * 0.8 + fi * 3.0, 3.0) * 0.5 + 0.5;
    let sheet = smoothstep(0.45, 0.75, curtain) * (0.55 - fi * 0.10);
    col = mix(col, sheet_tone, sheet);
  }
  let lane = uv.x + uv.y * 0.25;
  let fine = line_near(sin(lane * 240.0 + seed * 7.0), 0.35);
  let gust = fbm(uv.x * 3.0 - seed, uv.y * 3.0 + seed, 3.0) * 0.5 + 0.5;
  col = mix(col, glowc, fine * gust * 0.30);
  let splash = speckle(px, 2.0, seed + 5.0, 0.95) * smoothstep(0.7, 1.0, uv.y);
  col = mix(col, glowc, splash * 0.6);
  col = mix(col, back_lo * 0.8, smoothstep(0.85, 1.0, uv.y) * 0.5);
  return sat3(col);
}
