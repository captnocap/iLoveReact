// @material mercury_pool
// @slug mercury-pool
// @name Mercury Pool
// @board gradients
// @variant-labels Clear Mercury, Silver Mercury, Dark Mercury
// @kind gradient
// @tags gradients, mercury, pool, reflective
// @author editor
fn mercury_pool(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.70, 0.72, 0.76);
  var tint = vec3f(0.95, 0.99, 1.00);
  var shadow = vec3f(0.12, 0.12, 0.13);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.58, 0.56, 0.58);
    tint = vec3f(0.78, 0.84, 0.88);
    shadow = vec3f(0.20, 0.21, 0.24);
  } else if (variant >= 1.5) {
    base = vec3f(0.30, 0.30, 0.32);
    tint = vec3f(0.88, 0.78, 0.65);
    shadow = vec3f(0.05, 0.05, 0.07);
  }
  let wave = sin(uv.x * 25.0 + uv.y * 3.0 + seed * 0.5 + U.time);
  let bowl = smoothstep(0.15, 0.90, uv.y);
  let ring = 1.0 - smoothstep(0.018, 0.033, abs(length(uv - vec2f(0.5, 0.5)) - 0.32));
  var col = mix(base, tint, sat(bowl + wave * 0.5 + 0.5) * 0.5);
  col = mix(col, shadow, ring * (0.6 + wave * 0.25));
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 2.0, seed + 4.0, 0.982);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 2.8, seed + 10.0, 0.95);
  return sat3(col);
}
