// @material licorice_allsorts
// @slug licorice-allsorts
// @name Licorice Allsorts
// @board props
// @variant-labels Sweet Shop, Bold Neon, Dusty Jar
// @kind surface
// @tags props, licorice, candy, blocks
// @author fable-food
fn licorice_allsorts(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ink = vec3f(0.09, 0.07, 0.08);
  var cA = vec3f(0.95, 0.70, 0.20);
  var cB = vec3f(0.90, 0.45, 0.60);
  var cC = vec3f(0.94, 0.92, 0.86);
  var cD = vec3f(0.35, 0.70, 0.55);
  var dust = 0.15;
  if (variant > 0.5 && variant < 1.5) {
    cA = vec3f(0.98, 0.85, 0.10);
    cB = vec3f(0.95, 0.25, 0.60);
    cC = vec3f(0.30, 0.85, 0.90);
    cD = vec3f(0.60, 0.95, 0.30);
    dust = 0.0;
  } else if (variant >= 1.5) {
    cA = vec3f(0.80, 0.60, 0.24);
    cB = vec3f(0.74, 0.42, 0.50);
    cC = vec3f(0.84, 0.80, 0.72);
    cD = vec3f(0.36, 0.58, 0.48);
    dust = 0.6;
  }
  let cols = 4.0;
  let rows = 3.0;
  let cell = floor(vec2f(uv.x * cols, uv.y * rows));
  let local = fract(vec2f(uv.x * cols, uv.y * rows));
  let pick = fract(rand(cell + vec2f(seed * 0.31, seed * 0.17)) * 4.0);
  var face = cA;
  if (pick > 0.25 && pick <= 0.5) { face = cB; }
  if (pick > 0.5 && pick <= 0.75) { face = cC; }
  if (pick > 0.75) { face = cD; }
  let bandCount = 3.0 + floor(rand(cell + vec2f(3.0, seed)) * 2.0) * 2.0;
  let band = floor(local.y * bandCount);
  let isInk = band - floor(band * 0.5) * 2.0;
  var col = mix(face, ink, isInk);
  let ex = min(local.x, 1.0 - local.x);
  let ey = min(local.y, 1.0 - local.y);
  let gap = 1.0 - smoothstep(0.02, 0.06, min(ex, ey));
  col = mix(col, vec3f(0.05, 0.04, 0.05), gap * 0.9);
  let bevelHi = smoothstep(0.06, 0.16, ex) * smoothstep(0.06, 0.16, ey);
  col = col * (0.75 + bevelHi * 0.32);
  let matte = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 2.0) * 0.5 + 0.5;
  col = col * (0.92 + matte * 0.14);
  let powder = speckle(px, 2.0, seed + 6.0, 0.955);
  col = mix(col, vec3f(0.96, 0.94, 0.90), powder * dust);
  return sat3(col);
}
