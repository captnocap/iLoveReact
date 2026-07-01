// @material pdx_carpet
// @slug pdx-carpet
// @name PDX Carpet
// @board neon_rot
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags neon_rot, pdx, carpet
// @author legacy
fn pdx_carpet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let pile = fbm(uv.x * 32.0 + seed, uv.y * 32.0 - seed, 5.0) * 0.5 + 0.5;
  let low_thread = line_near(sin((uv.x * 1.8 + uv.y) * 92.0), 0.13);
  var base_a = vec3f(0.015, 0.23, 0.24);
  var base_b = vec3f(0.04, 0.48, 0.48);
  if (variant > 0.5 && variant < 1.5) {
    base_a = vec3f(0.018, 0.14, 0.19);
    base_b = vec3f(0.06, 0.36, 0.46);
  } else if (variant >= 1.5) {
    base_a = vec3f(0.10, 0.20, 0.16);
    base_b = vec3f(0.35, 0.50, 0.34);
  }
  var col = mix(base_a, base_b, pile * 0.62 + low_thread * 0.12);

  let taxi_shadow =
    segment_mark(uv, vec2f(0.10, 0.80), vec2f(0.88, 0.18), 0.037) +
    segment_mark(uv, vec2f(0.17, 0.35), vec2f(0.82, 0.64), 0.030) +
    segment_mark(uv, vec2f(0.45, 0.54), vec2f(0.47, 0.14), 0.026) +
    segment_mark(uv, vec2f(0.36, 0.44), vec2f(0.20, 0.18), 0.023) +
    segment_mark(uv, vec2f(0.58, 0.43), vec2f(0.82, 0.34), 0.023);
  col = mix(col, vec3f(0.010, 0.045, 0.050), sat(taxi_shadow) * 0.62);

  let main_lane = segment_mark(uv, vec2f(0.10, 0.80), vec2f(0.88, 0.18), 0.020);
  let cross_lane = segment_mark(uv, vec2f(0.17, 0.35), vec2f(0.82, 0.64), 0.014);
  let tower_lane = segment_mark(uv, vec2f(0.45, 0.54), vec2f(0.47, 0.14), 0.012);
  let west_lane = segment_mark(uv, vec2f(0.36, 0.44), vec2f(0.20, 0.18), 0.010);
  let east_lane = segment_mark(uv, vec2f(0.58, 0.43), vec2f(0.82, 0.34), 0.010);
  col = mix(col, vec3f(0.10, 0.95, 0.92), main_lane * 0.78);
  col = mix(col, vec3f(0.18, 0.34, 0.95), cross_lane * 0.68);
  col = mix(col, vec3f(0.94, 0.12, 0.50), tower_lane * 0.64);
  col = mix(col, vec3f(0.96, 0.68, 0.16), west_lane * 0.62);
  col = mix(col, vec3f(0.72, 0.24, 0.96), east_lane * 0.58);

  let node_a = dot_mark(uv, vec2f(0.45, 0.54), 0.034);
  let node_b = dot_mark(uv, vec2f(0.27, 0.66), 0.022);
  let node_c = dot_mark(uv, vec2f(0.70, 0.32), 0.025);
  let node_d = dot_mark(uv, vec2f(0.82, 0.64), 0.019);
  col = mix(col, vec3f(0.92, 0.96, 0.72), node_a * 0.82);
  col = mix(col, vec3f(0.95, 0.20, 0.18), node_b * 0.70);
  col = mix(col, vec3f(0.06, 0.95, 0.72), node_c * 0.72);
  col = mix(col, vec3f(0.88, 0.60, 0.96), node_d * 0.62);

  let scuff = blotch(uv, vec2f(0.63, 0.70), 0.15, vec2f(1.5, 0.7), seed + 2.0);
  let gum = dot_mark(uv, vec2f(0.23, 0.78), 0.025) * smoothstep(1.0, 1.8, variant);
  let worn_track = segment_mark(uv, vec2f(0.08, 0.52), vec2f(0.92, 0.56), 0.040) * speckle(px, 3.0, seed, 0.76);
  col = mix(col, vec3f(0.07, 0.09, 0.08), scuff * 0.34 + worn_track * 0.20);
  col = mix(col, vec3f(0.62, 0.58, 0.48), gum * 0.72);
  return neon_grime(uv, px, col, seed + 16.0, variant);
}
