// @material waffle_grid
// @slug waffle-grid
// @name Waffle Grid
// @board props
// @variant-labels Golden Fresh, Deep Toasted, Syrup Flood
// @kind surface
// @tags props, waffle, breakfast, golden
// @author fable-food
fn waffle_grid(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let sc = 6.0;
  let guv = vec2f(uv.x * sc, uv.y * sc);
  let cell = floor(guv);
  let local = fract(guv);
  let ex = min(local.x, 1.0 - local.x);
  let ey = min(local.y, 1.0 - local.y);
  let ridge = smoothstep(0.10, 0.30, min(ex, ey));
  var hi = vec3f(0.93, 0.72, 0.36);
  var lo = vec3f(0.55, 0.32, 0.12);
  var syrup = vec3f(0.42, 0.18, 0.05);
  var syrupAmt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    hi = vec3f(0.78, 0.50, 0.20);
    lo = vec3f(0.36, 0.17, 0.06);
    syrup = vec3f(0.30, 0.11, 0.03);
    syrupAmt = 0.2;
  } else if (variant >= 1.5) {
    hi = vec3f(0.95, 0.75, 0.40);
    lo = vec3f(0.58, 0.34, 0.13);
    syrup = vec3f(0.50, 0.20, 0.04);
    syrupAmt = 0.85;
  }
  let toast = fbm(uv.x * 9.0 + seed, uv.y * 9.0, 3.0) * 0.5 + 0.5;
  var col = mix(hi, lo, ridge * 0.85);
  col = mix(col, lo * 0.8, toast * 0.35);
  let scorch = speckle(px + cell * 13.0, 4.0, seed, 0.94) * ridge;
  col = mix(col, vec3f(0.24, 0.10, 0.04), scorch * 0.5);
  let pool = blotch(uv, vec2f(0.42, 0.5), 0.34, vec2f(1.1, 1.1), seed + 4.0);
  let pool2 = blotch(uv, vec2f(0.72, 0.28), 0.18, vec2f(0.9, 0.9), seed + 11.0);
  let jam = sat(max(pool, pool2) * (0.35 + syrupAmt));
  col = mix(col, syrup, jam * 0.9);
  let gleam = smoothstep(0.55, 0.9, jam) * smoothstep(0.2, 0.45, ridge);
  col = mix(col, vec3f(0.96, 0.72, 0.38), gleam * 0.4);
  return sat3(col);
}
