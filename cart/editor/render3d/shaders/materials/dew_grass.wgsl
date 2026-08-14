// @material dew_grass
// @slug dew-grass
// @name Dew Grass
// @board environment
// @variant-labels Sunrise Beads, Cool Shade, Autumn Wet
// @kind surface
// @tags environment, dew, grass
// @author fable-water_weather
fn dew_grass(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var blade_lo = vec3f(0.08, 0.20, 0.06);
  var blade_hi = vec3f(0.22, 0.42, 0.14);
  var bead_body = vec3f(0.55, 0.72, 0.68);
  var bead_spark = vec3f(1.0, 0.96, 0.80);
  if (variant > 0.5 && variant < 1.5) {
    blade_lo = vec3f(0.05, 0.14, 0.08);
    blade_hi = vec3f(0.12, 0.28, 0.16);
    bead_body = vec3f(0.44, 0.60, 0.66);
    bead_spark = vec3f(0.86, 0.94, 1.0);
  } else if (variant >= 1.5) {
    blade_lo = vec3f(0.16, 0.18, 0.05);
    blade_hi = vec3f(0.36, 0.36, 0.12);
    bead_body = vec3f(0.58, 0.62, 0.52);
    bead_spark = vec3f(1.0, 0.90, 0.66);
  }
  let sway = fbm(uv.x * 3.0 + seed, uv.y * 3.0, 2.0) * 0.2;
  let blades = fract((uv.x + sway) * 34.0 + rand(vec2f(floor(uv.y * 8.0), seed)) * 0.7);
  let blade_shape = smoothstep(0.0, 0.35, blades) * (1.0 - smoothstep(0.55, 1.0, blades));
  let clump = fbm(uv.x * 6.0 - seed, uv.y * 6.0 + seed, 3.0) * 0.5 + 0.5;
  var col = mix(blade_lo, blade_hi, blade_shape * (0.4 + 0.6 * clump));
  col = mix(col, blade_lo * 0.6, smoothstep(0.6, 1.0, uv.y) * 0.4);
  let vor = voronoi(uv.x * 24.0 + seed, uv.y * 24.0 - seed);
  let keep = step(0.62, rand(vec2f(vor.y, seed + 6.0)));
  let bead = smoothstep(0.13, 0.05, vor.x) * keep;
  col = mix(col, bead_body, bead * 0.85);
  col = mix(col, bead_spark, smoothstep(0.04, 0.0, vor.x) * keep);
  let shadow_ring = smoothstep(0.16, 0.13, vor.x) * (1.0 - smoothstep(0.13, 0.08, vor.x)) * keep;
  col = mix(col, blade_lo * 0.5, shadow_ring * 0.5);
  let mist = fbm(uv.x * 2.0 + seed, uv.y * 2.0 - seed, 2.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.80, 0.86, 0.82), smoothstep(0.75, 1.0, mist) * 0.15);
  return sat3(col);
}
