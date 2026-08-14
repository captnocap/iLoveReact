// @material veneer_lace
// @slug veneer-lace
// @name Veneer Lace
// @board facades
// @variant-labels Warm Grain, Cool Grain, Patina
// @kind surface
// @tags facades, veneer, grain, wood
// @author editor
fn veneer_lace(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var near = vec3f(0.67, 0.46, 0.29);
  var far = vec3f(0.39, 0.28, 0.20);
  var veining = vec3f(0.24, 0.15, 0.08);
  if (variant > 0.5 && variant < 1.5) {
    near = vec3f(0.52, 0.62, 0.58);
    far = vec3f(0.31, 0.40, 0.33);
    veining = vec3f(0.12, 0.19, 0.14);
  } else if (variant >= 1.5) {
    near = vec3f(0.86, 0.71, 0.46);
    far = vec3f(0.48, 0.39, 0.23);
    veining = vec3f(0.70, 0.35, 0.16);
  }
  let rings = floor(uv.y * 12.0);
  let warp = fbm(uv.x * 5.0 + seed, uv.y * 10.0 + seed * 0.3, 5.0) * 0.5 + 0.5;
  let wave = sin((uv.x + rings * 0.01) * 64.0 + uv.y * 7.0 + seed) * 0.5 + 0.5;
  var grain = mix(near, far, warp * 0.7 + wave * 0.2);
  let wood = smoothstep(0.20, 0.92, uv.y);
  var col = mix(far, grain, wood);
  let lace = 1.0 - smoothstep(0.025, 0.035, abs(fract((uv.x + uv.y) * 26.0 + seed * 0.3) - 0.5));
  col = mix(col, veining, lace * 0.4);
  col = mix(col, vec3f(0.08, 0.05, 0.03), speckle(px, 2.3, seed + 5.0, 0.94) * 0.14);
  return sat3(col);
}
