// @material diamond_pave
// @slug diamond-pave
// @name Diamond Pave
// @board neon_surface
// @variant-labels White Gold Bed, Yellow Gold Bed, Black Ice
// @kind surface
// @tags neon_surface, diamond, pave, sparkle
// @author fable-gems_precious
fn diamond_pave(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var setting = vec3f(0.62, 0.64, 0.68);
  var stone_hi = vec3f(0.96, 0.97, 0.99);
  var stone_lo = vec3f(0.66, 0.72, 0.82);
  if (variant > 0.5 && variant < 1.5) {
    setting = vec3f(0.72, 0.58, 0.26);
  } else if (variant >= 1.5) {
    setting = vec3f(0.30, 0.30, 0.34); stone_hi = vec3f(0.55, 0.58, 0.66); stone_lo = vec3f(0.16, 0.18, 0.24);
  }
  let sc = 9.0;
  var p = uv * sc;
  let row = floor(p.y);
  p.x = p.x + fract(row * 0.5) + seed * 0.09;
  let cell = vec2f(floor(p.x), row);
  let lc = fract(p) - vec2f(0.5, 0.5);
  let cid = rand(cell + vec2f(seed * 0.011, seed * 0.019));
  let r = length(lc);
  var col = mix(setting * 0.75, setting, fbm(uv.x * 22.0 + seed, uv.y * 22.0, 3.0) * 0.5 + 0.5);
  let stone_m = smoothstep(0.42, 0.36, r);
  let ang = atan2(lc.y, lc.x) + cid * 6.28;
  let facet = floor((ang / 6.28318 + 0.5) * 8.0);
  let fshade = rand(vec2f(facet + cid * 31.0, seed * 0.03));
  var stone_c = mix(stone_lo, stone_hi, 0.25 + 0.75 * fshade);
  stone_c = mix(stone_c, stone_hi * 1.1, smoothstep(0.14, 0.0, r));
  col = mix(col, stone_c, stone_m);
  col = mix(col, setting * 0.5, line_near(r - 0.40, 0.03) * 0.6);
  let blaze = step(0.90, rand(cell + vec2f(seed * 0.023, 4.0)));
  col = mix(col, vec3f(1.0, 0.99, 0.94), blaze * stone_m * 0.55);
  col += vec3f(1.0, 1.0, 0.96) * speckle(px, 2.0, seed, 0.993) * 0.6;
  return sat3(col);
}
