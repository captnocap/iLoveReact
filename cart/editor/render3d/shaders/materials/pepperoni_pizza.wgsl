// @material pepperoni_pizza
// @slug pepperoni-pizza
// @name Pepperoni Pizza
// @board props
// @variant-labels Classic Slice, Extra Char, Loaded Pie
// @kind surface
// @tags props, pizza, cheese, pepperoni
// @author fable-food
fn pepperoni_pizza(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var cheese = vec3f(0.95, 0.82, 0.44);
  var sauceTone = vec3f(0.75, 0.28, 0.10);
  var pep = vec3f(0.72, 0.16, 0.10);
  var pepRim = vec3f(0.48, 0.09, 0.06);
  var charAmt = 0.3;
  var pepScale = 3.0;
  if (variant > 0.5 && variant < 1.5) {
    cheese = vec3f(0.88, 0.70, 0.34);
    sauceTone = vec3f(0.62, 0.22, 0.08);
    pep = vec3f(0.60, 0.12, 0.08);
    pepRim = vec3f(0.34, 0.06, 0.04);
    charAmt = 0.8;
  } else if (variant >= 1.5) {
    cheese = vec3f(0.96, 0.84, 0.48);
    sauceTone = vec3f(0.80, 0.30, 0.10);
    pep = vec3f(0.78, 0.20, 0.12);
    pepRim = vec3f(0.52, 0.10, 0.06);
    pepScale = 4.0;
  }
  let melt = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5;
  var col = mix(cheese, sauceTone, smoothstep(0.6, 0.95, melt) * 0.65);
  col = mix(col, cheese * 1.1, smoothstep(0.3, 0.05, melt) * 0.5);
  let guv = vec2f(uv.x * pepScale, uv.y * pepScale);
  let cell = floor(guv);
  let jit = vec2f(rand(cell + vec2f(seed, 1.0)) - 0.5, rand(cell + vec2f(2.0, seed)) - 0.5) * 0.34;
  let ctr = vec2f(0.5, 0.5) + jit;
  let d = length(fract(guv) - ctr);
  let prad = 0.26 + rand(cell + vec2f(seed, 7.0)) * 0.06;
  let pepMask = 1.0 - smoothstep(prad * 0.92, prad, d);
  let cup = smoothstep(prad * 0.55, prad * 0.9, d);
  var pepCol = mix(pep, pepRim, cup);
  let fatFleck = speckle(px + cell * 17.0, 3.0, seed + 3.0, 0.93);
  pepCol = mix(pepCol, vec3f(0.94, 0.72, 0.58), fatFleck * 0.55);
  col = mix(col, pepCol, pepMask);
  let bubble = speckle(px, 5.0, seed + 12.0, 0.955) * (1.0 - pepMask);
  col = mix(col, vec3f(0.42, 0.20, 0.06), bubble * charAmt);
  let gloss = smoothstep(0.75, 0.95, snoise(uv.x * 10.0 + seed, uv.y * 10.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.99, 0.90, 0.55), gloss * 0.22 * (1.0 - pepMask));
  return sat3(col);
}
