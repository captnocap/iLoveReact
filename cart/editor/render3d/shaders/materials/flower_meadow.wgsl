// @material flower_meadow
// @slug flower-meadow
// @name Flower Meadow
// @board environment
// @variant-labels Spring Mix, Golden Noon, Late Bloom
// @kind surface
// @tags environment, meadow, flowers
// @author fable-botanic
fn flower_meadow(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let clump = fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0) * 0.5 + 0.5;
  let sway = snoise(uv.x * 3.0 + seed, uv.y * 3.0) * 0.03;
  let blade = line_near(sin((uv.x + sway) * 92.0 + uv.y * 7.0), 0.20);
  var low = vec3f(0.055, 0.21, 0.085);
  var high = vec3f(0.28, 0.55, 0.17);
  var petal_a = vec3f(0.93, 0.48, 0.62);
  var petal_b = vec3f(0.95, 0.88, 0.42);
  var density = 0.60;
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.09, 0.24, 0.07);
    high = vec3f(0.42, 0.60, 0.16);
    petal_a = vec3f(0.98, 0.80, 0.30);
    petal_b = vec3f(0.92, 0.93, 0.90);
    density = 0.48;
  } else if (variant >= 1.5) {
    low = vec3f(0.14, 0.17, 0.06);
    high = vec3f(0.44, 0.46, 0.18);
    petal_a = vec3f(0.72, 0.40, 0.78);
    petal_b = vec3f(0.88, 0.55, 0.30);
    density = 0.74;
  }
  var col = mix(low, high, clump) + vec3f(0.08, 0.15, 0.05) * blade;
  let vres = voronoi(uv.x * 15.0 + seed * 0.7, uv.y * 15.0 + seed * 0.3);
  let pick = fract(vres.y * 13.73);
  let head = smoothstep(0.16, 0.06, vres.x) * step(density, pick);
  let hue = fract(vres.y * 7.31);
  let petal = mix(petal_a, petal_b, step(0.5, hue));
  col = mix(col, petal, head);
  let core = smoothstep(0.05, 0.015, vres.x) * step(density, pick);
  col = mix(col, vec3f(0.55, 0.42, 0.12), core * 0.8);
  return sat3(col);
}
