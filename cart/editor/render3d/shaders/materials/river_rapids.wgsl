// @material river_rapids
// @slug river-rapids
// @name River Rapids
// @board environment
// @variant-labels Mountain Run, Jungle Torrent, Glacial Melt
// @kind surface
// @tags environment, rapids, river
// @author fable-water_weather
fn river_rapids(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var flow_deep = vec3f(0.04, 0.14, 0.20);
  var flow_fast = vec3f(0.14, 0.34, 0.42);
  var froth = vec3f(0.90, 0.94, 0.95);
  var rock_tone = vec3f(0.20, 0.18, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    flow_deep = vec3f(0.05, 0.16, 0.10);
    flow_fast = vec3f(0.16, 0.36, 0.24);
    rock_tone = vec3f(0.15, 0.16, 0.12);
  } else if (variant >= 1.5) {
    flow_deep = vec3f(0.08, 0.22, 0.30);
    flow_fast = vec3f(0.36, 0.58, 0.62);
    froth = vec3f(0.95, 0.98, 1.0);
    rock_tone = vec3f(0.26, 0.26, 0.28);
  }
  let stream = fbm(uv.x * 3.0 + seed, uv.y * 16.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(flow_deep, flow_fast, stream);
  let vor = voronoi(uv.x * 5.0 + seed, uv.y * 5.0 - seed * 0.5);
  let rock = smoothstep(0.18, 0.10, vor.x) * step(0.55, rand(vec2f(vor.y, seed)));
  let wake = smoothstep(0.34, 0.14, vor.x) * step(0.55, rand(vec2f(vor.y, seed)));
  let churn = fbm(uv.x * 10.0 - seed, uv.y * 22.0 + seed, 4.0) * 0.5 + 0.5;
  let white = smoothstep(0.55, 0.85, churn * (0.5 + wake));
  col = mix(col, froth, white);
  col = mix(col, rock_tone * (0.7 + 0.5 * rand(vec2f(vor.y, seed + 2.0))), rock);
  col = mix(col, froth, smoothstep(0.13, 0.10, abs(vor.x - 0.15)) * step(0.55, rand(vec2f(vor.y, seed))) * 0.7);
  let spray = speckle(px, 2.2, seed + 5.0, 0.93) * white;
  col = mix(col, vec3f(0.98, 1.0, 0.99), spray * 0.5);
  return sat3(col);
}
