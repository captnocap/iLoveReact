// @material rot_siding
// @slug rot-siding
// @name Rot Siding
// @board condemned
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags condemned, rot, siding
// @author legacy
fn rot_siding(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let planks = 5.0 + variant;
  let plank_id = floor(uv.x * planks);
  let local_x = fract(uv.x * planks);
  let seam_mark = 1.0 - smoothstep(0.025, 0.055, min(local_x, 1.0 - local_x));
  let board_tone = rand(vec2f(plank_id, seed));
  var wood_col = mix(vec3f(0.28, 0.17, 0.09), vec3f(0.58, 0.39, 0.20), board_tone);
  wood_col = wood_col + vec3f(line_near(sin((uv.y + fbm(uv.x * 4.0 + seed, uv.y * 8.0, 4.0) * 0.05) * 90.0), 0.12) * 0.055);
  var paint = vec3f(0.58, 0.62, 0.54);
  if (variant > 0.5 && variant < 1.5) { paint = vec3f(0.28, 0.47, 0.58); }
  else if (variant >= 1.5) { paint = vec3f(0.70, 0.56, 0.35); }
  let peel = smoothstep(0.52, 0.68, fbm(uv.x * 7.0 + seed, uv.y * 5.0 - seed, 5.0) * 0.5 + 0.5);
  var col = mix(paint, wood_col, peel);
  let rot = smoothstep(0.46, 0.92, uv.y) * smoothstep(0.40, 0.72, fbm(uv.x * 9.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.035, 0.040, 0.026), rot * 0.78);
  col = mix(col, vec3f(0.018, 0.016, 0.014), seam_mark * 0.80);
  return sat3(col - vec3f(vertical_drips(uv, seed, variant) * 0.20 + speckle(px, 3.0, seed, 0.90) * 0.10));
}
