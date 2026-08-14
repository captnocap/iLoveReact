// @material alien_alloy
// @slug alien-alloy
// @name Alien Alloy
// @board neon_surface
// @variant-labels Oilslick Chrome, Chitin Green, Ashen Relic
// @kind surface
// @tags neon_surface, alien, iridescent, metal
// @author fable-scifi_hull
fn alien_alloy(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base_lo = vec3f(0.16, 0.14, 0.22);
  var base_hi = vec3f(0.38, 0.36, 0.48);
  var veinc = vec3f(0.06, 0.04, 0.10);
  var glint = vec3f(0.85, 0.90, 0.95);
  var irid = 0.5;
  if (variant > 0.5 && variant < 1.5) {
    base_lo = vec3f(0.08, 0.16, 0.10);
    base_hi = vec3f(0.22, 0.40, 0.24);
    veinc = vec3f(0.03, 0.08, 0.04);
    glint = vec3f(0.80, 0.95, 0.70);
    irid = 0.25;
  } else if (variant >= 1.5) {
    base_lo = vec3f(0.24, 0.22, 0.20);
    base_hi = vec3f(0.48, 0.45, 0.42);
    veinc = vec3f(0.10, 0.08, 0.07);
    glint = vec3f(0.92, 0.88, 0.80);
    irid = 0.12;
  }
  let vor = voronoi(uv.x * 5.0 + seed * 0.37, uv.y * 5.0 + seed * 0.11);
  let cell_tone = rand(vec2f(vor.y * 37.0, seed));
  var col = mix(base_lo, base_hi, cell_tone * 0.6 + (fbm(uv.x * 7.0 + seed, uv.y * 7.0, 3.0) * 0.5 + 0.5) * 0.4);
  let vein = 1.0 - smoothstep(0.0, 0.07, abs(snoise(uv.x * 6.0 + seed, uv.y * 6.0)));
  let vein2 = 1.0 - smoothstep(0.0, 0.05, abs(snoise(uv.x * 13.0, uv.y * 13.0 + seed * 2.0)));
  col = mix(col, veinc, sat(vein * 0.8 + vein2 * 0.4));
  let hue = fract(fbm(uv.x * 3.0 + seed * 0.5, uv.y * 3.0, 3.0) + uv.x * 0.4 + seed * 0.09);
  let shimmer = hsv2rgb(hue, 0.8, 1.0);
  let sheen = pow(fbm(uv.x * 4.0 - seed, uv.y * 4.0 + seed, 3.0) * 0.5 + 0.5, 2.0);
  col = mix(col, shimmer, sheen * irid);
  let pore = dot_mark(fract(uv * 11.0 + vor.y), vec2f(0.5, 0.5), 0.09) * step(0.72, rand(floor(uv * 11.0) + vec2f(seed, 1.0)));
  col = mix(col, veinc * 0.7, pore * 0.8);
  let spark = speckle(px, 2.0, seed + 3.0, 0.982);
  col = col + glint * spark * 0.45;
  let seam_glow = vein * (snoise(uv.x * 2.0 + seed * 3.1, uv.y * 2.0) * 0.5 + 0.5);
  col = col + shimmer * seam_glow * irid * 0.5;
  return sat3(col);
}
