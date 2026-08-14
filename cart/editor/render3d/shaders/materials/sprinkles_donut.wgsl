// @material sprinkles_donut
// @slug sprinkles-donut
// @name Sprinkles Donut
// @board props
// @variant-labels Pink Glaze, Choco Dip, Vanilla Frost
// @kind surface
// @tags props, donut, sprinkles, sweet
// @author fable-food
fn sprinkles_donut(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var glaze = vec3f(0.96, 0.56, 0.72);
  var glazeLo = vec3f(0.84, 0.38, 0.56);
  var shine = vec3f(0.99, 0.85, 0.90);
  if (variant > 0.5 && variant < 1.5) {
    glaze = vec3f(0.36, 0.19, 0.10);
    glazeLo = vec3f(0.22, 0.11, 0.06);
    shine = vec3f(0.60, 0.40, 0.26);
  } else if (variant >= 1.5) {
    glaze = vec3f(0.95, 0.90, 0.80);
    glazeLo = vec3f(0.82, 0.74, 0.60);
    shine = vec3f(1.0, 0.98, 0.92);
  }
  let flow = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5;
  var col = mix(glazeLo, glaze, flow);
  let gleam = smoothstep(0.68, 0.92, snoise(uv.x * 8.0 + seed * 0.4, uv.y * 8.0) * 0.5 + 0.5);
  col = mix(col, shine, gleam * 0.45);
  let sc = 9.0;
  let guv = vec2f(uv.x * sc, uv.y * sc);
  let cell = floor(guv);
  let local = fract(guv);
  let r0 = rand(cell + vec2f(seed, 5.0));
  let r1 = rand(cell + vec2f(11.0, seed));
  let has = step(0.42, r0);
  let ang = r1 * 6.28318;
  let dir = vec2f(cos(ang), sin(ang)) * 0.22;
  let mid = vec2f(0.28 + r0 * 0.44, 0.28 + r1 * 0.44);
  let sprMask = segment_mark(local, mid - dir, mid + dir, 0.075) * has;
  let hue = fract(r0 * 5.7 + r1 * 3.3 + seed * 0.017);
  let sprCol = hsv2rgb(hue, 0.85, 0.95);
  col = mix(col, sprCol, sprMask * 0.95);
  let sprShadow = segment_mark(local + vec2f(-0.03, -0.04), mid - dir, mid + dir, 0.085) * has;
  col = mix(col, glazeLo * 0.7, sat(sprShadow - sprMask) * 0.5);
  let sugarDust = speckle(px, 2.0, seed + 8.0, 0.975);
  col = mix(col, shine, sugarDust * 0.4);
  return sat3(col);
}
