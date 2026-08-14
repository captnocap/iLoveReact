// @material plasma_conduit
// @slug plasma-conduit
// @name Plasma Conduit
// @board neon_surface
// @variant-labels Cyan Feed, Overload Orange, Void Violet
// @kind surface
// @tags neon_surface, plasma, pipe, glow
// @author fable-scifi_hull
fn plasma_conduit(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var core = vec3f(0.80, 0.98, 1.00);
  var haze = vec3f(0.10, 0.65, 0.85);
  var armor = vec3f(0.16, 0.18, 0.22);
  if (variant > 0.5 && variant < 1.5) {
    core = vec3f(1.00, 0.92, 0.70);
    haze = vec3f(0.95, 0.45, 0.10);
    armor = vec3f(0.14, 0.10, 0.09);
  } else if (variant >= 1.5) {
    core = vec3f(0.92, 0.80, 1.00);
    haze = vec3f(0.50, 0.20, 0.90);
    armor = vec3f(0.10, 0.09, 0.16);
  }
  let wave = snoise(uv.x * 5.0 + seed * 0.7, seed) * 0.05 + snoise(uv.x * 14.0, seed * 1.9) * 0.02;
  let d = abs(uv.y - 0.5 - wave);
  let inner = 1.0 - smoothstep(0.14, 0.17, d);
  let turb = fbm(uv.x * 12.0 + seed * 3.0, uv.y * 8.0, 3.0) * 0.5 + 0.5;
  var col = armor * (0.7 + fbm(uv.x * 9.0 + seed, uv.y * 9.0, 3.0) * 0.5 + 0.25);
  let chanel = 1.0 - smoothstep(0.20, 0.24, d);
  col = mix(col, vec3f(0.04, 0.04, 0.06), chanel);
  let glow = exp(-d * d * 90.0) * (0.6 + turb * 0.5);
  col = col + haze * glow;
  let hotcore = exp(-d * d * 900.0) * (0.7 + turb * 0.5);
  col = col + core * hotcore;
  let ribx = fract(uv.x * 5.0 + seed * 0.23);
  let rib = 1.0 - smoothstep(0.030, 0.055, min(ribx, 1.0 - ribx));
  let ribshade = mix(1.0, 0.5, smoothstep(0.0, 0.35, d));
  col = mix(col, armor * 1.5 * ribshade, rib * inner);
  col = mix(col, armor * 1.35, rib * (1.0 - inner) * 0.9);
  let bolt = dot_mark(vec2f(ribx, fract(uv.y * 4.0)), vec2f(0.5, 0.5), 0.10) * rib;
  col = mix(col, vec3f(0.40, 0.42, 0.46), bolt * 0.8);
  let grime = vertical_drips(uv, seed + 5.0, 0.4) * (1.0 - inner);
  col = mix(col, col * 0.55, grime * 0.5);
  return sat3(col);
}
