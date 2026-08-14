// @material copper_patina
// @slug copper-patina
// @name Copper Patina
// @board metal_yard
// @variant-labels New Copper, Verdigris, Rain Streaks
// @kind surface
// @tags metal_yard, copper, patina
// @author legacy
fn copper_patina(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = mix(vec3f(0.62, 0.28, 0.10), vec3f(0.96, 0.56, 0.22), fbm(uv.x * 10.0, uv.y * 10.0 + seed, 4.0) * 0.5 + 0.5);
  let pat = smoothstep(0.50, 0.80, fbm(uv.x * 7.0 + seed, uv.y * 7.0, 5.0) * 0.5 + 0.5);
  if (variant > 0.5) { col = mix(col, vec3f(0.10, 0.58, 0.48), pat * (0.55 + step(1.5, variant) * 0.25)); }
  if (variant >= 1.5) { col = mix(col, vec3f(0.04, 0.16, 0.14), vertical_drips(uv, seed, 1.0) * 0.55); }
  return sat3(col);
}
