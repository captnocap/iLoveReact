// @material plasma_glass
// @slug plasma-glass
// @name Plasma Glass
// @board neon_surface
// @variant-labels Clear Shell, Distorted Shell, Burned Shell
// @kind surface
// @tags neon_surface, glass, plasma
// @author editor
fn plasma_glass(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var core = vec3f(0.85, 0.94, 1.0);
  var fog = vec3f(0.14, 0.22, 0.30);
  var haze = vec3f(0.45, 0.16, 0.28);
  if (variant > 0.5 && variant < 1.5) {
    core = vec3f(0.88, 1.0, 0.82);
    fog = vec3f(0.16, 0.10, 0.28);
    haze = vec3f(0.25, 0.58, 0.32);
  } else if (variant >= 1.5) {
    core = vec3f(0.98, 0.74, 0.84);
    fog = vec3f(0.33, 0.16, 0.14);
    haze = vec3f(0.76, 0.12, 0.10);
  }
  let refractBand = 1.0 - abs(sin((uv.x + fbm(uv.x * 10.0, uv.y * 12.0, 4.0) * 0.4) * 8.0));
  let warp = fbm(uv.x * 7.5 + seed, uv.y * 7.5 + seed * 0.4, 5.0) * 0.5 + 0.5;
  let edge = 1.0 - smoothstep(0.02, 0.08, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  var col = mix(vec3f(0.06, 0.08, 0.09), fog, 0.7);
  col = mix(col, core, smoothstep(0.30, 0.85, warp) * refractBand);
  col = mix(col, haze, edge * 0.35);
  col = col + vec3f(0.06, 0.05, 0.05) * speckle(px, 2.0, seed + 2.0, 0.98);
  return sat3(col);
}
