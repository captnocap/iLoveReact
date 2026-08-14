// @material glacier_tide
// @slug glacier-tide
// @name Glacier Tide
// @board environment
// @variant-labels Distant Frost, Fracture Freeze, Submerged White
// @kind surface
// @tags environment, glacier, tide, crack
// @author editor
fn glacier_tide(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ice = vec3f(0.74, 0.86, 0.90);
  var deep = vec3f(0.35, 0.41, 0.49);
  var vein = vec3f(0.06, 0.10, 0.15);
  if (variant > 0.5 && variant < 1.5) {
    ice = vec3f(0.86, 0.96, 1.00);
    deep = vec3f(0.48, 0.54, 0.60);
    vein = vec3f(0.17, 0.24, 0.30);
  } else if (variant >= 1.5) {
    ice = vec3f(0.95, 0.98, 1.00);
    deep = vec3f(0.61, 0.66, 0.75);
    vein = vec3f(0.02, 0.06, 0.10);
  }
  let field = fbm(uv.x * 6.0 + seed, uv.y * 4.5 + seed * 0.2, 5.0) * 0.5 + 0.5;
  let fracture = line_near(sin(uv.y * 30.0 + uv.x * 16.0 + seed), 0.028);
  var col = mix(deep, ice, smoothstep(0.35, 0.80, field));
  col = mix(col, vein, fracture * (0.2 + uv.y * 0.4));
  col = col + vec3f(0.02, 0.02, 0.02) * speckle(px, 2.0, seed + 2.0, 0.98);
  col = col - vec3f(0.06, 0.06, 0.07) * speckle(px, 3.0, seed + 9.0, 0.94);
  return sat3(col);
}
