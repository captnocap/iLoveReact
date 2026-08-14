// @material reactor_core
// @slug reactor-core
// @name Reactor Core
// @board neon_surface
// @variant-labels Fusion Blue, Meltdown Red, Antique Emerald
// @kind composition
// @tags neon_surface, reactor, glow, radial
// @author fable-scifi_hull
fn reactor_core(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var corec = vec3f(0.85, 0.97, 1.00);
  var aura = vec3f(0.15, 0.55, 0.95);
  var ribc = vec3f(0.18, 0.20, 0.25);
  if (variant > 0.5 && variant < 1.5) {
    corec = vec3f(1.00, 0.85, 0.60);
    aura = vec3f(0.95, 0.25, 0.10);
    ribc = vec3f(0.16, 0.10, 0.09);
  } else if (variant >= 1.5) {
    corec = vec3f(0.85, 1.00, 0.85);
    aura = vec3f(0.15, 0.80, 0.35);
    ribc = vec3f(0.20, 0.19, 0.14);
  }
  let p = uv - vec2f(0.5, 0.5);
  let r = length(p) * 2.0;
  let ang = atan2(p.y, p.x);
  let pulse = snoise(r * 3.0 - seed * 1.7, seed * 0.9) * 0.5 + 0.5;
  var col = vec3f(0.03, 0.03, 0.05);
  let plate = fbm(uv.x * 10.0 + seed, uv.y * 10.0, 3.0) * 0.5 + 0.5;
  col = mix(col, ribc * 0.8, smoothstep(0.55, 0.75, r) * (0.6 + plate * 0.4));
  col = col + aura * exp(-r * r * 5.0) * (0.7 + pulse * 0.5);
  col = col + corec * exp(-r * r * 40.0) * (0.8 + pulse * 0.4);
  let ringd = abs(fract(r * 4.0 + seed * 0.13) - 0.5);
  let ring = exp(-ringd * ringd * 400.0) * smoothstep(0.12, 0.3, r) * (1.0 - smoothstep(0.8, 1.0, r));
  col = col + aura * ring * 0.5;
  let spokeN = 8.0;
  let sa = abs(fract(ang / 6.2831853 * spokeN + seed * 0.07) - 0.5);
  let spoke = 1.0 - smoothstep(0.05, 0.09, sa);
  let spokezone = smoothstep(0.30, 0.36, r) * (1.0 - smoothstep(0.92, 1.05, r));
  let rim = aura * exp(-r * 1.5) * 0.8;
  col = mix(col, ribc + rim, spoke * spokezone);
  let boltd = abs(fract(r * 4.0) - 0.5);
  let bolt = exp(-boltd * boltd * 900.0) * spoke * spokezone;
  col = mix(col, vec3f(0.50, 0.52, 0.56), bolt * 0.6);
  let flick = speckle(px, 2.0, seed, 0.985) * exp(-r * 2.0);
  col = col + corec * flick * 0.6;
  return sat3(col);
}
