// @material storm_shear
// @slug storm-shear
// @name Storm Shear
// @board environment
// @variant-labels Wet Dust, Oil Sheen, Black Ice
// @kind surface
// @tags environment, storm, road, shear
// @author editor
fn storm_shear(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var mud = vec3f(0.18, 0.14, 0.11);
  var runoff = vec3f(0.08, 0.08, 0.09);
  var foam = vec3f(0.62, 0.57, 0.50);
  if (variant > 0.5 && variant < 1.5) {
    mud = vec3f(0.14, 0.13, 0.15);
    runoff = vec3f(0.10, 0.12, 0.14);
    foam = vec3f(0.48, 0.52, 0.55);
  } else if (variant >= 1.5) {
    mud = vec3f(0.10, 0.12, 0.15);
    runoff = vec3f(0.16, 0.16, 0.19);
    foam = vec3f(0.30, 0.34, 0.40);
  }
  let rain = fbm(uv.x * 8.0 + seed, uv.y * 10.0 + seed * 0.7, 5.0) * 0.5 + 0.5;
  let lane = 1.0 - smoothstep(0.18, 0.50, abs(uv.x - 0.50 + sin(uv.y * 9.0 + seed) * 0.040));
  var col = mix(mud, runoff, rain * 0.68);
  let shear = 1.0 - smoothstep(0.030, 0.052, abs(uv.y - (fract(uv.x * 8.0) * 0.17 + 0.415)));
  col = mix(col, foam, lane * 0.22);
  col = mix(col, vec3f(0.75, 0.78, 0.82), shear * 0.28);
  col = mix(col, foam * 0.6, crack_field(uv, seed + 2.0, 16.0) * 0.3);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.0, seed + 11.0, 0.965);
  col = col - vec3f(0.06, 0.06, 0.06) * speckle(px, 2.8, seed + 17.0, 0.972);
  return sat3(col);
}
