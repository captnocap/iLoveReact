// @material linoleum
// @slug linoleum
// @name Linoleum
// @board condemned
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags condemned, linoleum
// @author legacy
fn linoleum(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * (vec2f(3.0, 3.0) + vec2f(variant * 0.8, variant * 0.4));
  let cell = floor(grid);
  let local = fract(grid);
  let seam_mark = max(1.0 - smoothstep(0.025, 0.055, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.025, 0.055, min(local.y, 1.0 - local.y)));
  let tone = rand(cell + vec2f(seed, seed * 2.0));
  var col = mix(vec3f(0.46, 0.42, 0.30), vec3f(0.78, 0.73, 0.52), tone);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.18, 0.36, 0.34), vec3f(0.62, 0.74, 0.63), tone);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.25, 0.20, 0.18), vec3f(0.52, 0.47, 0.38), tone);
  }
  col = col + vec3f((fbm(uv.x * 26.0 + seed, uv.y * 26.0, 5.0) * 0.5) * 0.16);
  col = mix(col, vec3f(0.08, 0.07, 0.055), seam_mark * 0.76);
  col = col - vec3f(crack_field(uv + vec2f(0.1, 0.0), seed, 8.0) * 0.26);
  col = mix(col, vec3f(0.025, 0.020, 0.018), (1.0 - smoothstep(0.025, 0.075, length(uv - vec2f(0.67, 0.42)))) * 0.82);
  return sat3(col - vec3f(speckle(px, 2.4, seed, 0.88) * 0.08));
}
