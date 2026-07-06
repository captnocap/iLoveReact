// @material pancake_stack
// @slug pancake-stack
// @name Pancake Stack
// @board props
// @variant-labels Diner Butter, Berry Drizzle, Choco Tower
// @kind composition
// @tags props, pancake, breakfast, stack
// @author fable-food
fn pancake_stack(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var plate = vec3f(0.88, 0.90, 0.92);
  var cake = vec3f(0.92, 0.70, 0.38);
  var rim = vec3f(0.66, 0.40, 0.16);
  var sauce = vec3f(0.55, 0.24, 0.06);
  var topper = vec3f(0.97, 0.88, 0.42);
  if (variant > 0.5 && variant < 1.5) {
    plate = vec3f(0.92, 0.88, 0.84);
    cake = vec3f(0.90, 0.66, 0.34);
    rim = vec3f(0.62, 0.36, 0.14);
    sauce = vec3f(0.62, 0.10, 0.22);
    topper = vec3f(0.85, 0.20, 0.30);
  } else if (variant >= 1.5) {
    plate = vec3f(0.80, 0.82, 0.88);
    cake = vec3f(0.84, 0.58, 0.28);
    rim = vec3f(0.50, 0.28, 0.10);
    sauce = vec3f(0.26, 0.12, 0.05);
    topper = vec3f(0.34, 0.17, 0.08);
  }
  var col = plate * (0.9 + fbm(uv.x * 4.0 + seed, uv.y * 4.0, 2.0) * 0.2);
  let layers = 5.0;
  let wob = snoise(uv.x * 9.0 + seed, uv.y * 2.0) * 0.02;
  let band = (uv.y + wob - 0.25) * layers;
  let idx = floor(band);
  let lf = fract(band);
  let halfw = 0.32 + rand(vec2f(idx, seed)) * 0.06;
  let inCake = step(0.0, band) * step(band, layers) * step(abs(uv.x - 0.5), halfw);
  let bulge = smoothstep(0.0, 0.18, lf) * (1.0 - smoothstep(0.82, 1.0, lf));
  var stackCol = mix(rim, cake, bulge);
  let crumb = speckle(px + vec2f(idx * 31.0, 0.0), 3.0, seed, 0.94);
  stackCol = mix(stackCol, rim * 0.8, crumb * 0.4);
  col = mix(col, stackCol, inCake);
  let drip = vertical_drips(vec2f(uv.x, uv.y - 0.22), seed + 7.0, 0.8);
  let dripMask = sat(drip) * inCake * smoothstep(0.6, 0.2, uv.y);
  col = mix(col, sauce, dripMask * 0.9);
  let capMask = inCake * (1.0 - smoothstep(0.25, 0.33, uv.y)) * step(0.22, uv.y);
  col = mix(col, sauce, capMask * 0.85);
  let pat = dot_mark(uv, vec2f(0.5, 0.245), 0.05);
  col = mix(col, topper, pat);
  col = mix(col, vec3f(1.0, 0.98, 0.9), dot_mark(uv, vec2f(0.485, 0.235), 0.014));
  return sat3(col);
}
