// @material wall_flag
// @slug wall-flag
// @name Hanging Flag
// @board wall_props
// @variant-labels Red, Blue & Gold, Green
// @kind surface
// @tags wall_props, hanging, flag
// @author legacy
fn wall_flag(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Apartment wall with a striped banner hung from a wall bracket, swaying.
  var col = brick_facade(uv, px, 0.0, seed);
  // Bracket arm.
  let arm = (1.0 - smoothstep(0.0, 0.012, abs(uv.y - 0.88))) * step(0.18, uv.x) * step(uv.x, 0.42);
  col = mix(col, vec3f(0.10, 0.10, 0.11), arm);
  // Banner cloth: a vertical sway shifts the x-sample with height.
  let sway = sin(uv.y * 5.0 + U.time * 1.5 + seed) * 0.015 * smoothstep(0.88, 0.30, uv.y);
  let bx = uv.x + sway;
  let banner = step(0.20, bx) * step(bx, 0.40) * step(0.30, uv.y) * step(uv.y, 0.86);
  var c1 = vec3f(0.80, 0.16, 0.18);
  var c2 = vec3f(0.92, 0.90, 0.86);
  if (variant > 0.5 && variant < 1.5) { c1 = vec3f(0.10, 0.28, 0.62); c2 = vec3f(0.95, 0.82, 0.25); }
  else if (variant >= 1.5) { c1 = vec3f(0.10, 0.45, 0.25); c2 = vec3f(0.88, 0.84, 0.30); }
  let stripe = step(0.5, fract(uv.y * 9.0));
  var bcol = mix(c1, c2, stripe * 0.5);
  let midx = (bx - 0.20) / 0.20;
  let emblem = 1.0 - smoothstep(0.050, 0.065, length(vec2f(bx, uv.y) - vec2f(0.30, 0.66)));
  bcol = mix(bcol, c2, emblem);
  bcol = bcol * (0.85 + 0.15 * sin(midx * 6.2831 + sway * 30.0)); // cloth fold shading
  col = mix(col, bcol, banner);
  // Fringe of tassels along the bottom edge.
  let fringe = step(0.20, bx) * step(bx, 0.40) * (1.0 - smoothstep(0.0, 0.012, abs(uv.y - 0.30))) * step(0.5, fract(bx * 30.0));
  col = mix(col, c2, fringe);
  return sat3(col);
}
