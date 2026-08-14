// @material hull_plating
// @slug hull-plating
// @name Hull Plating
// @board neon_surface
// @variant-labels Fleet Grey, Battle Scarred, Ceramic White
// @kind surface
// @tags neon_surface, scifi, hull, metal
// @author fable-scifi_hull
fn hull_plating(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rows = 4.0;
  let row = floor(uv.y * rows);
  let shift = rand(vec2f(row, seed)) * 0.7;
  let buv = vec2f(uv.x * 3.0 + shift, uv.y * rows);
  let cell = floor(buv);
  let local = fract(buv);
  let nx = min(local.x, 1.0 - local.x);
  let ny = min(local.y, 1.0 - local.y);
  let seam = max(1.0 - smoothstep(0.008, 0.032, nx), 1.0 - smoothstep(0.012, 0.042, ny));
  let tone = rand(cell + vec2f(seed * 0.13, seed * 0.07));
  var lo = vec3f(0.38, 0.41, 0.46);
  var hi = vec3f(0.56, 0.60, 0.66);
  var seamc = vec3f(0.12, 0.14, 0.17);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.20, 0.21, 0.24);
    hi = vec3f(0.36, 0.35, 0.34);
    seamc = vec3f(0.05, 0.05, 0.07);
  } else if (variant >= 1.5) {
    lo = vec3f(0.72, 0.73, 0.75);
    hi = vec3f(0.88, 0.88, 0.90);
    seamc = vec3f(0.30, 0.33, 0.38);
  }
  var col = mix(lo, hi, tone);
  let brush = fbm(buv.x * 3.0 + seed, buv.y * 40.0, 3.0) * 0.5 + 0.5;
  col = col * (0.90 + brush * 0.18);
  let streak = vertical_drips(uv, seed + cell.x * 3.1, 0.45);
  col = mix(col, col * vec3f(0.55, 0.52, 0.50), streak * 0.5);
  if (variant > 0.5 && variant < 1.5) {
    let scorch = blotch(local, vec2f(0.5, 0.4), 0.45, vec2f(1.2, 1.2), seed + tone * 9.0);
    col = mix(col, vec3f(0.05, 0.04, 0.05), scorch * 0.7);
  }
  var riv = max(dot_mark(local, vec2f(0.08, 0.15), 0.022), dot_mark(local, vec2f(0.92, 0.15), 0.022));
  riv = max(riv, max(dot_mark(local, vec2f(0.08, 0.85), 0.022), dot_mark(local, vec2f(0.92, 0.85), 0.022)));
  col = mix(col, vec3f(0.16, 0.17, 0.20), riv * 0.8);
  col = mix(col, seamc, seam);
  return sat3(col);
}
