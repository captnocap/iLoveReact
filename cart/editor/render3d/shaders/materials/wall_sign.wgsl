// @material wall_sign
// @slug wall-sign
// @name Projecting Sign
// @board wall_props
// @variant-labels Blade, Neon, Shingle
// @kind surface
// @tags wall_props, projecting, sign
// @author legacy
fn wall_sign(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // A sign mounted to the apartment wall. variant 0 painted blade sign, 1 vertical
  // neon sign, 2 hanging wooden shingle.
  var col = brick_facade(uv, px, 0.0, seed);
  if (variant > 0.5 && variant < 1.5) {
    let box = rect_mask(uv, 0.16, 0.34, 0.10, 0.82, 0.006);
    col = mix(col, vec3f(0.05, 0.05, 0.07), box);
    let neon = vec3f(0.98, 0.24, 0.52);
    let row = fract(uv.y * 7.0);
    let letter = (1.0 - smoothstep(0.18, 0.30, abs(row - 0.5))) * step(0.20, uv.x) * step(uv.x, 0.30) * box;
    let cx = 1.0 - smoothstep(0.0, 0.06, abs(uv.x - 0.25));
    let buzz = 0.85 + 0.15 * sin(U.time * 28.0 + seed);
    col = col + neon * letter * cx * buzz;
    col = col + neon * box * exp(-abs(uv.x - 0.25) * 16.0) * 0.22;
    let bracket = (1.0 - smoothstep(0.0, 0.010, abs(uv.y - 0.78))) * step(0.34, uv.x) * step(uv.x, 0.42);
    col = mix(col, vec3f(0.10, 0.10, 0.11), bracket);
  } else {
    var board = vec3f(0.16, 0.30, 0.42);
    if (variant >= 1.5) { board = vec3f(0.34, 0.20, 0.10); }
    let arm = (1.0 - smoothstep(0.0, 0.012, abs(uv.y - 0.84))) * step(0.20, uv.x) * step(uv.x, 0.40);
    col = mix(col, vec3f(0.10, 0.10, 0.11), arm);
    let link = max(1.0 - smoothstep(0.0, 0.006, abs(uv.x - 0.26)), 1.0 - smoothstep(0.0, 0.006, abs(uv.x - 0.40))) * step(0.74, uv.y) * step(uv.y, 0.84);
    col = mix(col, vec3f(0.12, 0.12, 0.13), link);
    let sign = rect_mask(uv, 0.18, 0.48, 0.52, 0.74, 0.006);
    col = mix(col, board, sign);
    let border = sign * (1.0 - rect_mask(uv, 0.20, 0.46, 0.54, 0.72, 0.006));
    col = mix(col, vec3f(0.86, 0.80, 0.55), border * 0.8);
    let txt = rect_mask(uv, 0.23, 0.43, 0.60, 0.66, 0.006) * step(0.5, fract(uv.x * 22.0));
    col = mix(col, vec3f(0.90, 0.86, 0.62), txt * 0.9);
  }
  return sat3(col);
}
