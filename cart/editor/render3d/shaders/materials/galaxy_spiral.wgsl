// @material galaxy_spiral
// @slug galaxy-spiral
// @name Spiral Galaxy
// @board gradients
// @variant-labels Blue Pinwheel, Golden Bar, Ghost Arms
// @kind composition
// @tags gradients, galaxy, space, spiral
// @author fable-sky_space
fn galaxy_spiral(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.02, 0.02, 0.06);
  var armCol = vec3f(0.48, 0.60, 0.95);
  var coreCol = vec3f(0.99, 0.90, 0.72);
  var arms = 2.0;
  var twist = 6.0;
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.04, 0.02, 0.03); armCol = vec3f(0.90, 0.68, 0.35); coreCol = vec3f(0.99, 0.95, 0.85); arms = 3.0; twist = 4.0;
  } else if (variant >= 1.5) {
    deep = vec3f(0.02, 0.04, 0.05); armCol = vec3f(0.55, 0.85, 0.80); coreCol = vec3f(0.85, 0.92, 0.95); arms = 4.0; twist = 7.5;
  }
  let d = uv - vec2f(0.5, 0.5);
  let r = length(d) + 0.0005;
  let ang = atan2(d.y, d.x);
  let sp = sin(ang * arms - log(r) * twist + seed * 0.37);
  let grain = fbm(uv.x * 9.0 + seed, uv.y * 9.0, 4.0) + 0.5;
  let armMask = smoothstep(0.05, 0.95, sp * 0.5 + 0.5) * exp(-r * 4.2) * (0.45 + grain * 0.9);
  let coreGlow = exp(-r * r * 70.0);
  let halo = exp(-r * 3.2) * 0.18;
  var col = deep + armCol * armMask + coreCol * coreGlow + armCol * halo;
  let dust = smoothstep(0.2, 0.9, sin(ang * arms - log(r) * twist + seed * 0.37 - 0.9) * 0.5 + 0.5);
  col = col - vec3f(0.05, 0.05, 0.07) * dust * exp(-r * 5.0);
  col = col + vec3f(0.88, 0.90, 0.99) * speckle(px, 1.0, seed + 2.0, 0.975);
  col = col + armCol * speckle(px, 1.6, seed + 11.0, 0.988);
  return sat3(col);
}
