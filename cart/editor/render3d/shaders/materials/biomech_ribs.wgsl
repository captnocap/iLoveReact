// @material biomech_ribs
// @slug biomech-ribs
// @name Biomech Ribs
// @board neon_surface
// @variant-labels Bone Cathedral, Wet Obsidian, Infected Crimson
// @kind surface
// @tags neon_surface, biomech, organic, ribs
// @author fable-scifi_hull
fn biomech_ribs(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var flesh_lo = vec3f(0.30, 0.26, 0.20);
  var flesh_hi = vec3f(0.72, 0.66, 0.54);
  var crevice = vec3f(0.08, 0.06, 0.05);
  var slime = vec3f(0.55, 0.60, 0.40);
  if (variant > 0.5 && variant < 1.5) {
    flesh_lo = vec3f(0.06, 0.07, 0.09);
    flesh_hi = vec3f(0.25, 0.28, 0.33);
    crevice = vec3f(0.01, 0.02, 0.03);
    slime = vec3f(0.30, 0.55, 0.60);
  } else if (variant >= 1.5) {
    flesh_lo = vec3f(0.28, 0.08, 0.08);
    flesh_hi = vec3f(0.62, 0.24, 0.20);
    crevice = vec3f(0.10, 0.02, 0.03);
    slime = vec3f(0.80, 0.45, 0.30);
  }
  let bend = sin(uv.y * 7.0 + seed) * 0.06 + fbm(uv.x * 2.0, uv.y * 2.0 + seed, 3.0) * 0.10;
  let xx = uv.x + bend;
  let ribN = 7.0;
  let rib = sin(xx * ribN * 6.2831853) * 0.5 + 0.5;
  let ridge = pow(rib, 1.6);
  var col = mix(crevice, mix(flesh_lo, flesh_hi, ridge), smoothstep(0.06, 0.35, rib));
  let knuckley = fract(uv.y * 5.0 + rand(vec2f(floor(xx * ribN), seed)) * 0.8);
  let knuckle = exp(-pow(knuckley - 0.5, 2.0) * 60.0) * step(0.55, rib);
  col = mix(col, flesh_hi * 1.15, knuckle * 0.5);
  let organ = fbm(uv.x * 9.0 + seed * 1.7, uv.y * 9.0, 4.0) * 0.5 + 0.5;
  col = col * (0.8 + organ * 0.35);
  let gloss = pow(rib, 8.0) * (0.5 + organ * 0.5);
  col = col + slime * gloss * 0.45;
  let drip = vertical_drips(uv, seed * 1.3, 0.6) * (1.0 - rib);
  col = mix(col, slime * 0.5, drip * 0.35);
  let vein = 1.0 - smoothstep(0.0, 0.05, abs(snoise(uv.x * 8.0, uv.y * 8.0 + seed * 2.2)));
  col = mix(col, crevice, vein * (1.0 - ridge) * 0.5);
  let pore = speckle(px, 3.0, seed, 0.965) * (1.0 - rib);
  col = mix(col, crevice, pore * 0.5);
  return sat3(col);
}
