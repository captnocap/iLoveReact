// @material dalmatian_spots
// @slug dalmatian-spots
// @name Dalmatian Spots
// @board props
// @variant-labels Firehouse Classic, Liver Spotted, Inverse Night
// @kind surface
// @tags props, fur, spots
// @author fable-creature_skins
fn dalmatian_spots(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var coatc = vec3f(0.94, 0.93, 0.90);
  var spotc = vec3f(0.10, 0.09, 0.10);
  if (variant > 0.5 && variant < 1.5) {
    spotc = vec3f(0.35, 0.19, 0.10);
    coatc = vec3f(0.93, 0.90, 0.84);
  } else if (variant >= 1.5) {
    coatc = vec3f(0.12, 0.11, 0.12);
    spotc = vec3f(0.90, 0.89, 0.86);
  }
  let p1 = uv * 7.0 + vec2f(seed * 0.13, seed * 0.07);
  let c1 = floor(p1);
  let o1 = vec2f(rand(c1 + seed) - 0.5, rand(c1 * 1.7 + seed) - 0.5) * 0.36;
  let r1 = 0.10 + rand(c1 * 2.3 + seed) * 0.16;
  var m1 = (1.0 - smoothstep(r1 - 0.04, r1, length(fract(p1) - 0.5 - o1)));
  m1 = m1 * step(0.35, rand(c1 * 3.1 + seed));
  let p2 = uv * 11.0 + vec2f(seed * 0.31, seed * 0.23) + 0.5;
  let c2 = floor(p2);
  let o2 = vec2f(rand(c2 + seed * 1.3) - 0.5, rand(c2 * 1.9 + seed) - 0.5) * 0.40;
  let r2 = 0.07 + rand(c2 * 2.7 + seed) * 0.12;
  var m2 = (1.0 - smoothstep(r2 - 0.035, r2, length(fract(p2) - 0.5 - o2)));
  m2 = m2 * step(0.55, rand(c2 * 3.7 + seed));
  let fur = fbm(uv.x * 34.0 + seed, uv.y * 30.0, 3.0) * 0.5 + 0.5;
  var col = coatc * (0.93 + fur * 0.10);
  col = mix(col, spotc * (0.85 + fur * 0.30), max(m1, m2));
  col = col - vec3f(0.06, 0.06, 0.05) * (fbm(uv.x * 2.0, uv.y * 2.0 + seed, 3.0) * 0.5 + 0.5) * 0.4;
  return sat3(col);
}
