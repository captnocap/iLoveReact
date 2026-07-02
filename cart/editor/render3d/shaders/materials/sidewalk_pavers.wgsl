// @material sidewalk_pavers
// @slug sidewalk-pavers
// @name Sidewalk Pavers
// @board street_ground
// @variant-labels Red Brick, Concrete Blocks, Basalt Setts
// @kind surface
// @tags street_ground, sidewalk, pavers
// @author legacy
fn sidewalk_pavers(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let scale = select(vec2f(5.0, 9.0), vec2f(7.0, 7.0), variant >= 1.5);
  let g = uv * scale;
  let cell = floor(g);
  let l = fract(g);
  let edge = max(1.0 - smoothstep(0.018, 0.045, min(l.x, 1.0 - l.x)), 1.0 - smoothstep(0.018, 0.045, min(l.y, 1.0 - l.y)));
  let tone = rand(cell + vec2f(seed, seed * 2.0));
  var lo = vec3f(0.48, 0.13, 0.08);
  var hi = vec3f(0.78, 0.28, 0.14);
  if (variant > 0.5 && variant < 1.5) { lo = vec3f(0.45, 0.43, 0.39); hi = vec3f(0.72, 0.70, 0.64); }
  else if (variant >= 1.5) { lo = vec3f(0.12, 0.12, 0.13); hi = vec3f(0.34, 0.34, 0.36); }
  var col = mix(lo, hi, tone * 0.65 + fbm(uv.x * 16.0, uv.y * 16.0 + seed, 4.0) * 0.25);
  col = mix(col, vec3f(0.30, 0.29, 0.26), edge * 0.84);
  col = mix(col, vec3f(0.18, 0.24, 0.10), speckle(px, 7.0, seed, 0.965) * 0.42);
  return sat3(col);
}
