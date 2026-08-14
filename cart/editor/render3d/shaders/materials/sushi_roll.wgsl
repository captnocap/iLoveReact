// @material sushi_roll
// @slug sushi-roll
// @name Sushi Roll
// @board props
// @variant-labels Salmon Maki, Tuna Set, Cucumber Cut
// @kind composition
// @tags props, sushi, japanese, roll
// @author fable-food
fn sushi_roll(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var slate = vec3f(0.16, 0.17, 0.19);
  var rice = vec3f(0.94, 0.93, 0.88);
  var nori = vec3f(0.10, 0.14, 0.09);
  var fill = vec3f(0.95, 0.48, 0.30);
  if (variant > 0.5 && variant < 1.5) {
    slate = vec3f(0.20, 0.18, 0.16);
    fill = vec3f(0.75, 0.16, 0.20);
  } else if (variant >= 1.5) {
    slate = vec3f(0.13, 0.16, 0.15);
    fill = vec3f(0.44, 0.72, 0.30);
  }
  let grain = fbm(uv.x * 8.0 + seed, uv.y * 8.0, 3.0) * 0.5 + 0.5;
  var col = slate * (0.82 + grain * 0.34);
  let guv = vec2f(uv.x * 3.0, uv.y * 3.0);
  let cell = floor(guv);
  let jit = vec2f(rand(cell + vec2f(seed, 3.0)) - 0.5, rand(cell + vec2f(9.0, seed)) - 0.5) * 0.16;
  let local = fract(guv) - vec2f(0.5, 0.5) - jit;
  let d = length(local);
  let noriMask = 1.0 - smoothstep(0.36, 0.385, d);
  let riceMask = 1.0 - smoothstep(0.315, 0.335, d);
  let fillMask = 1.0 - smoothstep(0.13, 0.155, d);
  col = mix(col, nori, noriMask);
  var riceCol = rice;
  let grainSpeck = speckle(px + cell * 23.0, 3.0, seed + 5.0, 0.82);
  riceCol = mix(riceCol, vec3f(0.80, 0.79, 0.72), grainSpeck * 0.6);
  col = mix(col, riceCol, riceMask);
  var fillCol = fill;
  let marb = snoise(local.x * 18.0 + seed, local.y * 18.0) * 0.5 + 0.5;
  fillCol = mix(fillCol, fillCol * 1.35, smoothstep(0.55, 0.8, marb) * 0.6);
  fillCol = mix(fillCol, fillCol * 0.7, smoothstep(0.45, 0.2, marb) * 0.5);
  col = mix(col, fillCol, fillMask);
  let sesame = speckle(px, 2.0, seed + 14.0, 0.985);
  col = mix(col, vec3f(0.92, 0.88, 0.70), sesame * (1.0 - noriMask) * 0.5);
  let rim = smoothstep(0.34, 0.385, d) * noriMask;
  col = mix(col, vec3f(0.04, 0.06, 0.04), rim * 0.6);
  return sat3(col);
}
