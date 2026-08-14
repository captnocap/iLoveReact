// @material baguette_slash
// @slug baguette-slash
// @name Baguette Slash
// @board props
// @variant-labels Boulangerie Gold, Well Fired, Flour Dusted
// @kind surface
// @tags props, bread, baguette, bakery
// @author fable-food
fn baguette_slash(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var gold = vec3f(0.83, 0.55, 0.22);
  var dark = vec3f(0.47, 0.24, 0.08);
  var crumbTone = vec3f(0.96, 0.88, 0.68);
  var dustAmt = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    gold = vec3f(0.62, 0.33, 0.11);
    dark = vec3f(0.28, 0.12, 0.04);
    crumbTone = vec3f(0.90, 0.78, 0.55);
    dustAmt = 0.15;
  } else if (variant >= 1.5) {
    gold = vec3f(0.86, 0.62, 0.30);
    dark = vec3f(0.55, 0.32, 0.12);
    crumbTone = vec3f(0.97, 0.91, 0.74);
    dustAmt = 0.85;
  }
  let barrel = sin(uv.x * 3.14159);
  let bump = fbm(uv.x * 8.0 + seed, uv.y * 14.0, 3.0) * 0.5 + 0.5;
  var col = mix(dark, gold, sat(barrel * 0.75 + bump * 0.35));
  var scoreMask = 0.0;
  var bloomMask = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    let fi = f32(i);
    let cy = 0.14 + fi * 0.24 + (rand(vec2f(fi, seed)) - 0.5) * 0.04;
    let a = vec2f(0.24, cy + 0.07);
    let b = vec2f(0.76, cy - 0.07);
    scoreMask = max(scoreMask, segment_mark(uv, a, b, 0.028));
    bloomMask = max(bloomMask, segment_mark(uv, a, b, 0.062));
  }
  col = mix(col, gold * 1.28, bloomMask * 0.65);
  col = mix(col, crumbTone, scoreMask * 0.92);
  let pore = speckle(px, 2.0, seed + 2.0, 0.93) * scoreMask;
  col = mix(col, dark, pore * 0.5);
  let flour = speckle(px, 3.0, seed + 8.0, 0.93 - dustAmt * 0.05);
  col = mix(col, vec3f(0.97, 0.95, 0.88), flour * dustAmt);
  col = col * (0.86 + bump * 0.24);
  return sat3(col);
}
