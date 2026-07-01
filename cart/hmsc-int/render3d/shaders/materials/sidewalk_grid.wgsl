// @material sidewalk_grid
// @slug sidewalk-grid
// @name Sidewalk Grid
// @board street_ground
// @variant-labels Old Grey, Warm Aggregate, Blue Dust
// @kind surface
// @tags street_ground, sidewalk, grid
// @author legacy
fn sidewalk_grid(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let slabs = vec2f(2.0 + variant, 4.0);
  let g = uv * slabs;
  let cell = floor(g);
  let l = fract(g + vec2f(rand(cell + vec2f(seed, seed)) * 0.035, rand(cell + vec2f(seed + 4.0, seed - 4.0)) * 0.030));
  let joint = max(1.0 - smoothstep(0.014, 0.035, min(l.x, 1.0 - l.x)), 1.0 - smoothstep(0.012, 0.033, min(l.y, 1.0 - l.y)));
  var lo = vec3f(0.48, 0.47, 0.44);
  var hi = vec3f(0.74, 0.72, 0.68);
  if (variant > 0.5 && variant < 1.5) { lo = vec3f(0.54, 0.46, 0.36); hi = vec3f(0.80, 0.69, 0.55); }
  else if (variant >= 1.5) { lo = vec3f(0.42, 0.46, 0.50); hi = vec3f(0.66, 0.70, 0.72); }
  var col = mix(lo, hi, fbm(uv.x * 12.0 + seed, uv.y * 12.0, 5.0) * 0.5 + 0.5);
  let gum = speckle(px, 4.0, seed, 0.965);
  let crack = crack_field(uv, seed, 8.0);
  col = mix(col, vec3f(0.34, 0.33, 0.31), joint * 0.85);
  col = mix(col, vec3f(0.80, 0.24, 0.38), gum * 0.45);
  return sat3(col - vec3f(crack * 0.12));
}
