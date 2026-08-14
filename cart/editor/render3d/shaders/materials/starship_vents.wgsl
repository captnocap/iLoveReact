// @material starship_vents
// @slug starship-vents
// @name Starship Vents
// @board neon_surface
// @variant-labels Cold Intake, Furnace Breath, Ion Blue
// @kind surface
// @tags neon_surface, vents, louvers, heat
// @author fable-scifi_hull
fn starship_vents(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var metal_lo = vec3f(0.16, 0.17, 0.20);
  var metal_hi = vec3f(0.42, 0.44, 0.48);
  var glow = vec3f(0.10, 0.12, 0.16);
  var glowamt = 0.25;
  if (variant > 0.5 && variant < 1.5) {
    metal_lo = vec3f(0.14, 0.10, 0.08);
    metal_hi = vec3f(0.36, 0.28, 0.22);
    glow = vec3f(1.00, 0.45, 0.10);
    glowamt = 1.0;
  } else if (variant >= 1.5) {
    metal_lo = vec3f(0.10, 0.12, 0.18);
    metal_hi = vec3f(0.30, 0.34, 0.44);
    glow = vec3f(0.25, 0.65, 1.00);
    glowamt = 0.8;
  }
  let slant = uv.y + uv.x * 0.22;
  let louvN = 8.0;
  let band = fract(slant * louvN + seed * 0.31);
  let bid = floor(slant * louvN + seed * 0.31);
  let face = smoothstep(0.0, 0.55, band) * (1.0 - smoothstep(0.55, 0.80, band));
  let slot = 1.0 - smoothstep(0.80, 0.88, band) + smoothstep(0.97, 1.0, band);
  let btone = rand(vec2f(bid, seed));
  var col = mix(metal_lo, metal_hi, face * (0.7 + btone * 0.3));
  let heat = fbm(uv.x * 6.0 + seed * 2.0, bid * 2.0, 3.0) * 0.5 + 0.5;
  col = mix(col, glow * (0.5 + heat * 0.8), sat(slot) * glowamt);
  col = col + glow * sat(slot) * heat * glowamt * 0.4;
  let scratch = fbm(uv.x * 40.0, slant * 6.0 + seed, 3.0) * 0.5 + 0.5;
  col = col * (0.88 + scratch * 0.2);
  let framev = step(uv.x, 0.045) + step(0.955, uv.x);
  col = mix(col, metal_lo * 0.8, sat(framev));
  let bolt = dot_mark(vec2f(fract(uv.x * 22.0), fract(uv.y * 7.0)), vec2f(0.5, 0.5), 0.13) * sat(framev);
  col = mix(col, metal_hi * 1.2, bolt * 0.8);
  let soot = vertical_drips(uv, seed + 3.0, 0.5);
  col = mix(col, col * vec3f(0.5, 0.47, 0.45), soot * 0.45);
  let nick = speckle(px, 3.0, seed, 0.972);
  col = mix(col, metal_hi * 1.3, nick * 0.35);
  return sat3(col);
}
