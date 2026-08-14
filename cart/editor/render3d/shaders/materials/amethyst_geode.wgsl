// @material amethyst_geode
// @slug amethyst-geode
// @name Amethyst Geode
// @board neon_surface
// @variant-labels Royal Purple, Pale Lilac, Smoky Core
// @kind composition
// @tags neon_surface, crystal, geode, purple
// @author fable-gems_precious
fn amethyst_geode(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var tooth_hi = vec3f(0.72, 0.48, 0.92);
  var tooth_lo = vec3f(0.30, 0.14, 0.48);
  var band = vec3f(0.78, 0.76, 0.82);
  var rock = vec3f(0.36, 0.31, 0.28);
  if (variant > 0.5 && variant < 1.5) {
    tooth_hi = vec3f(0.85, 0.74, 0.94); tooth_lo = vec3f(0.55, 0.42, 0.70);
    band = vec3f(0.88, 0.86, 0.90); rock = vec3f(0.48, 0.44, 0.40);
  } else if (variant >= 1.5) {
    tooth_hi = vec3f(0.66, 0.55, 0.44); tooth_lo = vec3f(0.24, 0.17, 0.14);
    band = vec3f(0.60, 0.58, 0.62); rock = vec3f(0.26, 0.24, 0.23);
  }
  let ctr = vec2f(0.5, 0.5);
  let wob = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.10;
  let r = length(uv - ctr) + wob;
  let vc = voronoi(uv.x * 9.0 + seed * 0.29, uv.y * 9.0);
  let fid = fract(vc.y * 7.77);
  var crystal = mix(tooth_lo, tooth_hi, 0.25 + 0.75 * fid);
  crystal = mix(crystal * 1.35, crystal, smoothstep(0.02, 0.20, vc.x));
  crystal = mix(crystal, tooth_lo * 0.7, smoothstep(0.30, 0.48, vc.x));
  let rings = sin(r * 55.0 + seed) * 0.5 + 0.5;
  let agate = mix(band * 0.75, band, rings);
  var rim = mix(rock * 0.7, rock * 1.15, fbm(uv.x * 14.0, uv.y * 14.0 + seed, 4.0) * 0.5 + 0.5);
  var col = crystal;
  col = mix(col, agate, smoothstep(0.33, 0.37, r));
  col = mix(col, rim, smoothstep(0.42, 0.46, r));
  col += vec3f(0.95, 0.90, 1.0) * speckle(px, 2.0, seed, 0.994) * step(r, 0.35) * 0.6;
  return sat3(col);
}
