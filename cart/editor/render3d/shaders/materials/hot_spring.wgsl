// @material hot_spring
// @slug hot-spring
// @name Hot Spring
// @board environment
// @variant-labels Prismatic Eye, Milky Azure, Rust Cauldron
// @kind composition
// @tags environment, spring, mineral
// @author fable-water_weather
fn hot_spring(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var core = vec3f(0.05, 0.35, 0.55);
  var mid_ring = vec3f(0.10, 0.62, 0.60);
  var rim_hot = vec3f(0.92, 0.72, 0.18);
  var rim_out = vec3f(0.72, 0.34, 0.12);
  var crust = vec3f(0.82, 0.78, 0.68);
  if (variant > 0.5 && variant < 1.5) {
    core = vec3f(0.28, 0.58, 0.72);
    mid_ring = vec3f(0.48, 0.74, 0.80);
    rim_hot = vec3f(0.86, 0.84, 0.76);
    rim_out = vec3f(0.62, 0.58, 0.50);
    crust = vec3f(0.88, 0.86, 0.80);
  } else if (variant >= 1.5) {
    core = vec3f(0.16, 0.20, 0.24);
    mid_ring = vec3f(0.30, 0.30, 0.22);
    rim_hot = vec3f(0.70, 0.36, 0.14);
    rim_out = vec3f(0.46, 0.20, 0.10);
    crust = vec3f(0.56, 0.44, 0.34);
  }
  let wob = fbm(uv.x * 6.0 + seed, uv.y * 6.0 - seed, 3.0) * 0.10;
  let d = length((uv - vec2f(0.5, 0.5)) * vec2f(1.0, 1.15)) + wob;
  var col = mix(core, mid_ring, smoothstep(0.10, 0.24, d));
  col = mix(col, rim_hot, smoothstep(0.24, 0.33, d));
  col = mix(col, rim_out, smoothstep(0.33, 0.40, d));
  col = mix(col, crust * (0.75 + 0.5 * (fbm(uv.x * 9.0 - seed, uv.y * 9.0, 3.0) * 0.5 + 0.5)), smoothstep(0.40, 0.47, d));
  let vein = line_near(sin(d * 55.0 + seed + wob * 30.0), 0.14) * smoothstep(0.20, 0.42, d) * (1.0 - smoothstep(0.44, 0.5, d));
  col = mix(col, crust * 0.8, vein * 0.5);
  let steamy = smoothstep(0.5, 0.85, fbm(uv.x * 4.0 + seed * 0.5, uv.y * 4.0 - seed, 3.0) * 0.5 + 0.5) * smoothstep(0.3, 0.05, d);
  col = mix(col, vec3f(0.90, 0.94, 0.95), steamy * 0.45);
  col = mix(col, crust * 1.1, speckle(px, 2.2, seed + 6.0, 0.94) * smoothstep(0.36, 0.46, d));
  return sat3(col);
}
