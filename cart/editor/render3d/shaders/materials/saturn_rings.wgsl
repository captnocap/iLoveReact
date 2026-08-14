// @material saturn_rings
// @slug saturn-rings
// @name Saturn Rings
// @board gradients
// @variant-labels Honey Gold, Icy Silver, Backlit Dark
// @kind gradient
// @tags gradients, rings, saturn, bands
// @author fable-sky_space
fn saturn_rings(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.28, 0.20, 0.12);
  var hi = vec3f(0.88, 0.72, 0.48);
  var voidTone = vec3f(0.05, 0.04, 0.06);
  var lift = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.30, 0.34, 0.42); hi = vec3f(0.85, 0.88, 0.92); voidTone = vec3f(0.04, 0.05, 0.08); lift = 0.05;
  } else if (variant >= 1.5) {
    lo = vec3f(0.10, 0.08, 0.09); hi = vec3f(0.45, 0.35, 0.26); voidTone = vec3f(0.02, 0.02, 0.03); lift = 0.0;
  }
  let y = uv.y;
  let bandId = floor(y * 22.0 + seed);
  let bandTone = rand(vec2f(bandId * 0.173, seed * 0.031));
  let fine = sin(y * 260.0 + seed * 3.0) * 0.5 + 0.5;
  var col = mix(lo, hi, sat(bandTone * 0.8 + fine * 0.25 + lift));
  let cassini = smoothstep(0.60, 0.63, y) * smoothstep(0.70, 0.67, y);
  col = mix(col, voidTone, cassini * 0.92);
  let encke = smoothstep(0.30, 0.312, y) * smoothstep(0.335, 0.323, y);
  col = mix(col, voidTone, encke * 0.8);
  let innerFade = smoothstep(0.0, 0.14, y);
  let outerFade = smoothstep(1.0, 0.90, y);
  col = mix(voidTone, col, innerFade * outerFade);
  let grain = fbm(uv.x * 30.0 + seed, y * 90.0, 3.0);
  col = col + vec3f(grain * 0.10);
  col = col + vec3f(0.85, 0.88, 0.95) * speckle(px, 1.0, seed, 0.988) * (1.0 - innerFade * outerFade);
  return sat3(col);
}
