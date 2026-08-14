// @material snow_drift
// @slug snow-drift
// @name Snow Drift
// @board environment
// @variant-labels Wind Combed, Fresh Powder, Moonlit Dunes
// @kind surface
// @tags environment, snow, drift
// @author fable-water_weather
fn snow_drift(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lit = vec3f(0.94, 0.96, 0.98);
  var shade = vec3f(0.62, 0.72, 0.86);
  var hollow = vec3f(0.48, 0.58, 0.76);
  var ridge_freq = 7.0;
  if (variant > 0.5 && variant < 1.5) {
    lit = vec3f(0.97, 0.97, 1.0);
    shade = vec3f(0.76, 0.82, 0.92);
    hollow = vec3f(0.62, 0.70, 0.84);
    ridge_freq = 4.0;
  } else if (variant >= 1.5) {
    lit = vec3f(0.70, 0.76, 0.90);
    shade = vec3f(0.34, 0.40, 0.60);
    hollow = vec3f(0.20, 0.24, 0.42);
    ridge_freq = 9.0;
  }
  let warp = fbm(uv.x * 2.5 + seed, uv.y * 2.5 - seed, 3.0) * 1.4;
  let phase = uv.x * ridge_freq + uv.y * 2.0 + warp + seed;
  let crest = sin(phase);
  let slope = cos(phase);
  var col = mix(shade, lit, sat(slope * 0.5 + 0.5));
  col = mix(col, hollow, smoothstep(0.3, 1.0, -crest) * 0.6);
  let sastrugi = line_near(sin(phase * 3.0 + warp * 2.0), 0.16);
  col = mix(col, shade, sastrugi * 0.30);
  let soft = fbm(uv.x * 8.0 - seed, uv.y * 8.0 + seed, 3.0) * 0.5 + 0.5;
  col = mix(col, lit, soft * 0.15);
  let sparkle = speckle(px, 1.8, seed + 5.0, 0.972);
  col = mix(col, vec3f(1.0, 1.0, 0.97), sparkle);
  return sat3(col);
}
