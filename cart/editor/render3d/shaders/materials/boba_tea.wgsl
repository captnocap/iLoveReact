// @material boba_tea
// @slug boba-tea
// @name Boba Tea
// @board props
// @variant-labels Classic Milk, Taro Purple, Matcha Green
// @kind composition
// @tags props, boba, tea, drink
// @author fable-food
fn boba_tea(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var teaTop = vec3f(0.92, 0.80, 0.62);
  var teaBot = vec3f(0.72, 0.52, 0.32);
  var pearl = vec3f(0.16, 0.10, 0.08);
  var strawCol = vec3f(0.94, 0.42, 0.56);
  if (variant > 0.5 && variant < 1.5) {
    teaTop = vec3f(0.86, 0.74, 0.90);
    teaBot = vec3f(0.62, 0.44, 0.74);
    strawCol = vec3f(0.98, 0.86, 0.30);
  } else if (variant >= 1.5) {
    teaTop = vec3f(0.80, 0.88, 0.62);
    teaBot = vec3f(0.50, 0.66, 0.34);
    strawCol = vec3f(0.30, 0.30, 0.32);
  }
  let milkCloud = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5;
  var col = mix(teaTop, teaBot, sat(uv.y * 1.15 - 0.08 + (milkCloud - 0.5) * 0.3));
  let swirlLine = line_near(sin(uv.y * 14.0 + uv.x * 3.0 + seed), 0.12) * (1.0 - uv.y);
  col = mix(col, teaTop * 1.08, swirlLine * 0.5);
  let pearlZone = smoothstep(0.60, 0.68, uv.y);
  let guv = vec2f(uv.x * 7.0, uv.y * 7.0);
  let cell = floor(guv + vec2f(0.0, floor(seed) * 0.5));
  let jit = vec2f(rand(cell + vec2f(seed, 1.0)) - 0.5, rand(cell + vec2f(4.0, seed)) - 0.5) * 0.3;
  let local = fract(guv) - vec2f(0.5, 0.5) - jit;
  let pd = length(local);
  let pearlMask = (1.0 - smoothstep(0.30, 0.35, pd)) * pearlZone;
  var pearlCol = mix(pearl, pearl * 2.2, 1.0 - smoothstep(0.0, 0.3, length(local + vec2f(0.1, 0.1))));
  col = mix(col, pearlCol, pearlMask * 0.95);
  let strawD = abs((uv.x - 0.62) + (uv.y - 0.5) * 0.22);
  let straw = 1.0 - smoothstep(0.035, 0.045, strawD);
  col = mix(col, strawCol, straw * 0.85);
  col = mix(col, strawCol * 1.3, (1.0 - smoothstep(0.006, 0.012, strawD)) * 0.5);
  let cupEdge = min(uv.x, 1.0 - uv.x);
  let wallShine = 1.0 - smoothstep(0.02, 0.10, cupEdge);
  col = mix(col, vec3f(0.98, 0.97, 0.95), wallShine * 0.4);
  let condensation = speckle(px, 2.0, seed + 8.0, 0.965);
  col = mix(col, vec3f(0.97, 0.96, 0.94), condensation * 0.35);
  return sat3(col);
}
