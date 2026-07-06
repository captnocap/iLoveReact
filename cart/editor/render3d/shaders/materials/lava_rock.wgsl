// @material lava_rock
// @slug lava-rock
// @name Lava Rock
// @board wood_brick_stone
// @variant-labels Cold Clinker, Ember Veins, Ropey Pahoehoe
// @kind surface
// @tags wood_brick_stone, lava, volcanic, porous
// @author fable-geology
fn lava_rock(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.14, 0.09, 0.08);
  var lift = vec3f(0.28, 0.18, 0.15);
  var hole = vec3f(0.03, 0.02, 0.02);
  var glow = vec3f(0.30, 0.14, 0.08);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.12, 0.07, 0.06);
    lift = vec3f(0.24, 0.14, 0.11);
    hole = vec3f(0.02, 0.01, 0.01);
    glow = vec3f(0.95, 0.38, 0.10);
  } else if (variant >= 1.5) {
    base = vec3f(0.16, 0.12, 0.11);
    lift = vec3f(0.32, 0.24, 0.20);
    hole = vec3f(0.04, 0.03, 0.03);
    glow = vec3f(0.40, 0.24, 0.14);
  }
  let lump = fbm(uv.x * 7.0 + seed * 0.6, uv.y * 7.0 - seed * 0.3, 4.0);
  var col = mix(base, lift, smoothstep(-0.15, 0.45, lump));
  if (variant >= 1.5) {
    let rope = sin((uv.y + fbm(uv.x * 3.0 + seed, uv.y * 1.5, 3.0) * 0.9) * 30.0 + uv.x * 5.0);
    col = mix(col, lift * 1.2, smoothstep(0.3, 0.95, rope) * 0.5);
    col = mix(col, hole, smoothstep(-0.95, -0.5, rope) * (1.0 - smoothstep(-0.5, 0.0, rope)) * 0.4);
  }
  let v1 = voronoi(uv.x * 20.0 + seed, uv.y * 20.0 - seed * 0.7);
  col = mix(col, hole, smoothstep(0.22, 0.06, v1.x) * step(0.4, rand(vec2f(v1.y, seed * 0.06))) * 0.9);
  let v2 = voronoi(uv.x * 44.0 - seed * 0.5, uv.y * 44.0 + seed * 0.8);
  col = mix(col, hole, smoothstep(0.16, 0.04, v2.x) * step(0.5, rand(vec2f(v2.y, 6.1))) * 0.7);
  let cracks = crack_field(uv, seed + 3.0, 3.5);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(col, glow, cracks * 0.85);
    col = col + glow * fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.25;
  } else {
    col = mix(col, hole, cracks * 0.6);
  }
  col = mix(col, lift * 1.3, speckle(px, 2.0, seed + 7.0, 0.985) * 0.5);
  return sat3(col);
}
