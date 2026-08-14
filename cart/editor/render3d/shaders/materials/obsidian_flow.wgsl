// @material obsidian_flow
// @slug obsidian-flow
// @name Obsidian Flow
// @board wood_brick_stone
// @variant-labels Jet Glass, Mahogany Swirl, Snowflake
// @kind surface
// @tags wood_brick_stone, obsidian, volcanic, glass
// @author fable-geology
fn obsidian_flow(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.03, 0.03, 0.05);
  var band_c = vec3f(0.10, 0.10, 0.14);
  var accent = vec3f(0.20, 0.22, 0.28);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.06, 0.03, 0.03);
    band_c = vec3f(0.22, 0.09, 0.06);
    accent = vec3f(0.38, 0.16, 0.09);
  } else if (variant >= 1.5) {
    deep = vec3f(0.04, 0.04, 0.06);
    band_c = vec3f(0.11, 0.11, 0.14);
    accent = vec3f(0.62, 0.63, 0.66);
  }
  let sway = fbm(uv.x * 2.5 + seed * 0.5, uv.y * 2.5 - seed * 0.2, 3.0);
  let flow = sin((uv.y + sway * 0.7) * 22.0 + uv.x * 4.0 + seed);
  var col = mix(deep, band_c, smoothstep(-0.6, 0.9, flow));
  let arc1 = length(uv - vec2f(0.28 + fract(seed * 0.03), 0.34));
  let arc2 = length(uv - vec2f(0.74, 0.68 + fract(seed * 0.05) * 0.2));
  col = col + accent * smoothstep(0.012, 0.003, abs(sin(arc1 * 34.0 + seed) * 0.05)) * smoothstep(0.30, 0.12, arc1) * 0.5;
  col = col + accent * smoothstep(0.012, 0.003, abs(sin(arc2 * 30.0) * 0.05)) * smoothstep(0.26, 0.10, arc2) * 0.4;
  if (variant >= 1.5) {
    let vc = voronoi(uv.x * 10.0 + seed, uv.y * 10.0);
    let flake_gate = step(0.62, rand(vec2f(vc.y, seed * 0.11)));
    col = mix(col, accent, smoothstep(0.20, 0.06, vc.x) * flake_gate * 0.85);
  }
  col = col + vec3f(0.85, 0.88, 0.95) * speckle(px, 2.0, seed + 3.0, 0.991) * 0.9;
  let sheen = pow(sat(1.0 - abs(uv.x - uv.y + 0.15 - fract(seed * 0.02) * 0.3) * 2.4), 4.0);
  col = col + vec3f(0.09, 0.10, 0.13) * sheen;
  return sat3(col);
}
