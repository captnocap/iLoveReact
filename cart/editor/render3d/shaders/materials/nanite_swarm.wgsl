// @material nanite_swarm
// @slug nanite-swarm
// @name Nanite Swarm
// @board neon_surface
// @variant-labels Silver Tide, Hungry Emerald, Ember Colony
// @kind surface
// @tags neon_surface, nanite, specks, tech
// @author fable-scifi_hull
fn nanite_swarm(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var steel_lo = vec3f(0.07, 0.08, 0.10);
  var steel_hi = vec3f(0.18, 0.19, 0.22);
  var mite = vec3f(0.75, 0.80, 0.88);
  var hotmite = vec3f(0.55, 0.90, 1.00);
  if (variant > 0.5 && variant < 1.5) {
    steel_lo = vec3f(0.04, 0.07, 0.05);
    steel_hi = vec3f(0.10, 0.16, 0.12);
    mite = vec3f(0.35, 0.85, 0.45);
    hotmite = vec3f(0.75, 1.00, 0.60);
  } else if (variant >= 1.5) {
    steel_lo = vec3f(0.09, 0.06, 0.05);
    steel_hi = vec3f(0.20, 0.14, 0.11);
    mite = vec3f(0.95, 0.55, 0.20);
    hotmite = vec3f(1.00, 0.85, 0.45);
  }
  let brush = fbm(uv.x * 3.0 + seed, uv.y * 30.0, 3.0) * 0.5 + 0.5;
  var col = mix(steel_lo, steel_hi, brush);
  let seamy = abs(fract(uv.y * 3.0 + seed * 0.19) - 0.5);
  col = mix(col, steel_lo * 0.6, 1.0 - smoothstep(0.008, 0.025, seamy));
  let cloud = fbm(uv.x * 4.0 + seed * 0.8, uv.y * 4.0 - seed * 0.3, 4.0) * 0.5 + 0.5;
  let swarm = smoothstep(0.45, 0.75, cloud);
  let flow = snoise(uv.x * 8.0 + seed, uv.y * 8.0) * 0.5 + 0.5;
  let dots = speckle(px + vec2f(flow * 6.0, 0.0), 2.0, seed, 0.88);
  let dots2 = speckle(px, 3.0, seed + 41.0, 0.93);
  col = mix(col, mite, dots * swarm * 0.9);
  col = mix(col, hotmite, dots2 * swarm);
  col = col + hotmite * dots2 * swarm * 0.6;
  let eaten = smoothstep(0.72, 0.95, cloud);
  let pit = fbm(uv.x * 20.0, uv.y * 20.0 + seed * 2.0, 3.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.02, 0.02, 0.03), eaten * pit * 0.8);
  col = col + mite * eaten * (1.0 - pit) * 0.25;
  let stray = speckle(px, 2.0, seed + 9.0, 0.992);
  col = col + mite * stray * 0.5;
  return sat3(col);
}
