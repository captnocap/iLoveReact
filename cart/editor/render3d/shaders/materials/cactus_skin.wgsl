// @material cactus_skin
// @slug cactus-skin
// @name Cactus Skin
// @board environment
// @variant-labels Saguaro Rib, Golden Barrel, Scarred Elder
// @kind surface
// @tags environment, cactus, desert
// @author fable-botanic
fn cactus_skin(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var flesh_lo = vec3f(0.06, 0.20, 0.09);
  var flesh_hi = vec3f(0.28, 0.52, 0.24);
  var spine_c = vec3f(0.90, 0.88, 0.72);
  var ribs = 22.0;
  var scar_amt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    flesh_lo = vec3f(0.14, 0.28, 0.08);
    flesh_hi = vec3f(0.44, 0.62, 0.20);
    spine_c = vec3f(0.95, 0.78, 0.24);
    ribs = 34.0;
  } else if (variant >= 1.5) {
    flesh_lo = vec3f(0.10, 0.18, 0.10);
    flesh_hi = vec3f(0.30, 0.42, 0.24);
    spine_c = vec3f(0.72, 0.68, 0.58);
    ribs = 18.0;
    scar_amt = 1.0;
  }
  let ribwave = sin(uv.x * ribs + seed + snoise(uv.x * 2.0 + seed, uv.y * 3.0) * 0.5);
  let shade = ribwave * 0.5 + 0.5;
  var col = mix(flesh_lo, flesh_hi, shade);
  let mottle = fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5;
  col = mix(col, col * vec3f(0.9, 1.05, 0.9), mottle * 0.5);
  let waxband = line_near(sin(uv.y * 60.0 + seed), 0.12);
  col = col + vec3f(0.04, 0.06, 0.04) * waxband * shade;
  let crest = smoothstep(0.80, 0.98, shade);
  let ay = fract(uv.y * 14.0 + fract(seed * 0.71));
  let areole = crest * smoothstep(0.16, 0.05, abs(ay - 0.5));
  col = mix(col, vec3f(0.32, 0.30, 0.20), areole * 0.7);
  let spines = areole * speckle(px, 2.0, seed + 1.0, 0.55);
  col = mix(col, spine_c, spines);
  let scar = blotch(uv, vec2f(fract(seed * 0.43) * 0.7 + 0.15, fract(seed * 0.29) * 0.7 + 0.15), 0.12, vec2f(1.4, 1.4), seed);
  col = mix(col, vec3f(0.38, 0.28, 0.16), scar * scar_amt * 0.85);
  return sat3(col);
}
