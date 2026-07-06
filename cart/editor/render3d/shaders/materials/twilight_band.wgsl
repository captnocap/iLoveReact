// @material twilight_band
// @slug twilight-band
// @name Twilight Band
// @board gradients
// @variant-labels Venus Belt, Cold Dusk, Smoke Horizon
// @kind gradient
// @tags gradients, twilight, dusk, sky
// @author fable-sky_space
fn twilight_band(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var upper = vec3f(0.10, 0.16, 0.38);
  var belt = vec3f(0.90, 0.55, 0.55);
  var shadow = vec3f(0.16, 0.18, 0.30);
  var beltY = 0.42;
  if (variant > 0.5 && variant < 1.5) {
    upper = vec3f(0.06, 0.10, 0.28); belt = vec3f(0.72, 0.42, 0.58); shadow = vec3f(0.10, 0.12, 0.24); beltY = 0.50;
  } else if (variant >= 1.5) {
    upper = vec3f(0.14, 0.14, 0.30); belt = vec3f(0.88, 0.48, 0.32); shadow = vec3f(0.20, 0.16, 0.22); beltY = 0.36;
  }
  let wob = fbm(uv.x * 2.5 + seed, 3.3, 3.0) * 0.04;
  let y = uv.y + wob;
  var col = mix(shadow, belt, smoothstep(beltY - 0.22, beltY, y));
  col = mix(col, upper, smoothstep(beltY, beltY + 0.35, y));
  let glowLine = exp(-abs(y - beltY) * 9.0);
  col = col + belt * glowLine * 0.25;
  let haze = fbm(uv.x * 5.0 - seed, uv.y * 4.0 + seed * 0.4, 4.0);
  col = col + vec3f(haze * 0.05);
  let stars = speckle(px, 1.0, seed, 0.982) * smoothstep(beltY + 0.15, beltY + 0.4, y);
  col = col + vec3f(0.85, 0.87, 0.95) * stars;
  let bandCloud = smoothstep(0.55, 0.85, fbm(uv.x * 4.0 + seed * 1.3, y * 14.0, 4.0) + 0.5);
  col = mix(col, shadow * 0.85, bandCloud * smoothstep(beltY + 0.05, beltY - 0.15, y) * 0.4);
  return sat3(col);
}
