// @material aurora_sky
// @slug aurora-sky
// @name Aurora Sky
// @board gradients
// @variant-labels Green Curtain, Violet Storm, Teal Ribbon
// @kind gradient
// @tags gradients, aurora, night, sky
// @author fable-sky_space
fn aurora_sky(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.02, 0.03, 0.08);
  var lowGlow = vec3f(0.15, 0.85, 0.45);
  var highGlow = vec3f(0.50, 0.25, 0.75);
  var rayScale = 9.0;
  if (variant > 0.5 && variant < 1.5) {
    night = vec3f(0.04, 0.02, 0.07); lowGlow = vec3f(0.70, 0.25, 0.80); highGlow = vec3f(0.90, 0.30, 0.35); rayScale = 13.0;
  } else if (variant >= 1.5) {
    night = vec3f(0.02, 0.04, 0.07); lowGlow = vec3f(0.20, 0.80, 0.75); highGlow = vec3f(0.25, 0.45, 0.90); rayScale = 6.0;
  }
  var col = mix(night, night * 1.8, uv.y * 0.4);
  let sway = fbm(uv.x * 2.2 + seed, uv.y * 0.6, 3.0);
  let rays = fbm(uv.x * rayScale + sway * 4.0 + seed * 1.7, seed * 0.11, 4.0) + 0.5;
  let bandCenter = 0.45 + sway * 0.25;
  let band = smoothstep(bandCenter - 0.30, bandCenter, uv.y) * smoothstep(bandCenter + 0.42, bandCenter + 0.05, uv.y);
  let strength = pow(sat(rays), 1.6) * band;
  let heightMixT = sat((uv.y - bandCenter + 0.1) * 2.6);
  col = col + mix(lowGlow, highGlow, heightMixT) * strength * 1.25;
  let stars = speckle(px, 1.0, seed, 0.972) + speckle(px, 1.8, seed + 5.0, 0.990);
  col = col + vec3f(0.85, 0.88, 0.95) * stars * sat(1.0 - strength * 2.0);
  let ridge = smoothstep(0.10, 0.0, uv.y - fbm(uv.x * 3.0 + seed, 4.2, 3.0) * 0.08 - 0.03);
  col = mix(col, vec3f(0.01, 0.02, 0.03), ridge);
  return sat3(col);
}
