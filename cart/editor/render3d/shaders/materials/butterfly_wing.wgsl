// @material butterfly_wing
// @slug butterfly-wing
// @name Butterfly Wing
// @board props
// @variant-labels Monarch Flame, Blue Morpho, Glasswing Dusk
// @kind composition
// @tags props, wing, insect
// @author fable-creature_skins
fn butterfly_wing(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var cellc = vec3f(0.90, 0.48, 0.10);
  var veinc = vec3f(0.10, 0.07, 0.06);
  var dotc = vec3f(0.93, 0.90, 0.84);
  if (variant > 0.5 && variant < 1.5) {
    cellc = vec3f(0.15, 0.42, 0.88);
    veinc = vec3f(0.05, 0.06, 0.12);
    dotc = vec3f(0.80, 0.88, 0.96);
  } else if (variant >= 1.5) {
    cellc = vec3f(0.62, 0.55, 0.50);
    veinc = vec3f(0.20, 0.15, 0.14);
    dotc = vec3f(0.90, 0.84, 0.72);
  }
  let vc = voronoi(uv.x * 4.5 + seed * 0.27, uv.y * 4.5 - seed * 0.33);
  let vein = smoothstep(0.30, 0.36, vc.x);
  let ctone = rand(vec2f(vc.y * 7.7, seed));
  let dust = fbm(uv.x * 20.0 + seed, uv.y * 20.0, 3.0) * 0.5 + 0.5;
  var col = cellc * (0.72 + ctone * 0.35 + dust * 0.18);
  let flame = smoothstep(0.2, 0.9, uv.y) * 0.3;
  col = mix(col, cellc * vec3f(1.15, 0.85, 0.70), flame);
  col = mix(col, veinc, vein * 0.95);
  let bd = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let border = 1.0 - smoothstep(0.09, 0.14, bd);
  col = mix(col, veinc, border);
  let dg = voronoi(uv.x * 11.0 + seed * 0.5, uv.y * 11.0 + seed * 0.4);
  let ddot = (1.0 - smoothstep(0.12, 0.20, dg.x)) * step(0.4, rand(vec2f(dg.y, seed)));
  col = mix(col, dotc, ddot * border);
  col = col + vec3f(0.10, 0.09, 0.07) * speckle(px, 2.0, seed, 0.95);
  return sat3(col);
}
