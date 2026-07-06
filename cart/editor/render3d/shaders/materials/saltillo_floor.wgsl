// @material saltillo_floor
// @slug saltillo-floor
// @name Saltillo Floor
// @board liminal
// @variant-labels Sun Terracotta, Rosewash, Sealed Dark
// @kind surface
// @tags liminal, tile, clay, floor
// @author fable-interior_home
fn saltillo_floor(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var clay_lo = vec3f(0.68, 0.38, 0.22);
  var clay_hi = vec3f(0.86, 0.56, 0.32);
  var grout = vec3f(0.56, 0.48, 0.40);
  var gloss_amt = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    clay_lo = vec3f(0.74, 0.48, 0.40);
    clay_hi = vec3f(0.90, 0.66, 0.55);
    grout = vec3f(0.62, 0.56, 0.50);
    gloss_amt = 0.2;
  } else if (variant >= 1.5) {
    clay_lo = vec3f(0.42, 0.22, 0.13);
    clay_hi = vec3f(0.62, 0.36, 0.20);
    grout = vec3f(0.30, 0.26, 0.22);
    gloss_amt = 0.7;
  }
  let cell = floor(uv * 3.0);
  let lc = fract(uv * 3.0);
  let tone = rand(cell + vec2f(seed * 0.013, seed * 0.007));
  let glaze = fbm(uv.x * 4.0 + tone * 9.0, uv.y * 4.0 + seed * 0.2, 3.0) * 0.5 + 0.5;
  var col = mix(clay_lo, clay_hi, tone * 0.5 + glaze * 0.5);
  let flame = fbm(uv.x * 2.0 + cell.y, uv.y * 2.0 + seed, 3.0) * 0.5 + 0.5;
  col = mix(col, clay_lo * 0.8, smoothstep(0.6, 0.9, flame) * 0.4);
  col = col + vec3f(0.14, 0.12, 0.09) * smoothstep(0.60, 0.85, glaze) * gloss_amt;
  let near_e = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  let mortar = 1.0 - smoothstep(0.025, 0.055, near_e);
  col = mix(col, grout, mortar * 0.9);
  col = mix(col, clay_lo * 0.55, speckle(px, 3.0, seed, 0.97) * 0.6);
  let paw = blotch(uv, vec2f(0.35 + fract(seed * 0.19) * 0.3, 0.5), 0.05, vec2f(1.0, 1.3), seed) * 0.25;
  col = mix(col, clay_lo * 0.7, paw);
  return sat3(col);
}
