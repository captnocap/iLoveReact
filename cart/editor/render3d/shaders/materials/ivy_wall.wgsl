// @material ivy_wall
// @slug ivy-wall
// @name Ivy Wall
// @board environment
// @variant-labels Creeping Start, Full Blanket, Crimson Fall
// @kind surface
// @tags environment, ivy, wall
// @author fable-botanic
fn ivy_wall(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var wall = brick_wall(uv, px, vec3f(0.40, 0.25, 0.19), vec3f(0.55, 0.36, 0.27), vec3f(0.60, 0.56, 0.50), seed);
  var dens = 0.35;
  var tint = vec3f(0.10, 0.30, 0.10);
  var tint_amt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    dens = 0.85;
    wall = brick_wall(uv, px, vec3f(0.34, 0.32, 0.30), vec3f(0.46, 0.44, 0.41), vec3f(0.56, 0.54, 0.50), seed);
  } else if (variant >= 1.5) {
    dens = 0.65;
    tint = vec3f(0.62, 0.16, 0.09);
    tint_amt = 0.75;
  }
  let growth = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 4.0) * 0.5 + 0.5;
  let climb = smoothstep(0.05, 0.85, uv.y * 0.6 + growth * 0.5);
  let cover = leaf_cover(uv * 3.0 + vec2f(seed * 0.2, 0.0), dens * climb, seed);
  var leaf = leaf_color(uv * 3.0 + vec2f(seed * 0.2, 0.0), seed);
  leaf = mix(leaf, tint, tint_amt);
  let vein = line_near(sin((uv.x + uv.y * 0.6) * 120.0 + seed), 0.15);
  leaf = leaf + vec3f(0.05, 0.08, 0.03) * vein;
  var col = mix(wall, leaf, cover);
  let tendril = line_near(sin(uv.x * 40.0 + snoise(uv.x * 3.0 + seed, uv.y * 3.0) * 4.0), 0.10);
  col = mix(col, vec3f(0.20, 0.26, 0.12), tendril * climb * (1.0 - cover) * 0.5);
  let shade = fbm(uv.x * 9.0 + seed * 1.7, uv.y * 9.0, 3.0) * 0.5 + 0.5;
  col = col * (0.82 + shade * 0.30);
  return sat3(col);
}
