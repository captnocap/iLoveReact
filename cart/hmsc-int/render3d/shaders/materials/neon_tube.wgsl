// @material neon_tube
// @slug neon-tube
// @name Neon Tube
// @board neon_surface
// @variant-labels Pink, Cyan, Orange
// @kind surface
// @tags neon_surface, neon, tube
// @author legacy
fn neon_tube(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Buzzing bent-glass sign tube on a dark backing board — the Sign thingymajigger.
  let buzz = 0.85 + 0.15 * sin(U.time * 40.0 + seed) * step(0.5, fract(U.time * 7.0 + seed));
  var tube = vec3f(0.98, 0.18, 0.62);
  if (variant > 0.5 && variant < 1.5) { tube = vec3f(0.12, 0.92, 0.96); }
  else if (variant >= 1.5) { tube = vec3f(0.98, 0.58, 0.12); }
  var col = mix(vec3f(0.02, 0.02, 0.03), vec3f(0.06, 0.05, 0.07), fbm(uv.x * 8.0 + seed, uv.y * 8.0, 4.0) * 0.5 + 0.5);
  let path_y = 0.5 + sin(uv.x * 9.0 + seed) * 0.22;
  let d = abs(uv.y - path_y);
  let core = 1.0 - smoothstep(0.012, 0.022, d);
  let glow = exp(-d * 26.0);
  let path_y2 = 0.5 + sin(uv.x * 9.0 + seed + 3.14159) * 0.14;
  let d2 = abs(uv.y - path_y2);
  let glow2 = exp(-d2 * 30.0);
  col = col + tube * (glow * 0.6 + glow2 * 0.4) * buzz;
  col = col + vec3f(1.0, 1.0, 1.0) * core * buzz * 0.9;
  return sat3(col);
}
