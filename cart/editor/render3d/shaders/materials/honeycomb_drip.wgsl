// @material honeycomb_drip
// @slug honeycomb-drip
// @name Honeycomb Drip
// @board props
// @variant-labels Amber Flow, Dark Forest, Fresh Wax
// @kind surface
// @tags props, honey, honeycomb, amber
// @author fable-food
fn honeycomb_drip(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var wax = vec3f(0.90, 0.62, 0.16);
  var cellDeep = vec3f(0.62, 0.34, 0.05);
  var honey = vec3f(0.98, 0.72, 0.20);
  var wall = vec3f(0.48, 0.26, 0.06);
  if (variant > 0.5 && variant < 1.5) {
    wax = vec3f(0.66, 0.40, 0.10);
    cellDeep = vec3f(0.38, 0.18, 0.03);
    honey = vec3f(0.80, 0.46, 0.10);
    wall = vec3f(0.28, 0.13, 0.03);
  } else if (variant >= 1.5) {
    wax = vec3f(0.95, 0.80, 0.42);
    cellDeep = vec3f(0.76, 0.52, 0.16);
    honey = vec3f(0.99, 0.84, 0.36);
    wall = vec3f(0.62, 0.42, 0.12);
  }
  let sc = 6.0;
  let p = vec2f(uv.x * sc + seed * 0.11, uv.y * sc + seed * 0.07);
  let rr = vec2f(1.0, 1.732);
  let hh = rr * 0.5;
  let a = fract(p / rr) * rr - hh;
  let b = fract((p + hh) / rr) * rr - hh;
  var gv = a;
  if (dot(b, b) < dot(a, a)) { gv = b; }
  let q = abs(gv);
  let hexD = max(dot(q, vec2f(0.5, 0.866)), q.x);
  let cellId = p - gv;
  let wallMask = smoothstep(0.38, 0.46, hexD);
  let fillLvl = rand(cellId + vec2f(seed * 0.19, seed * 0.23));
  var col = mix(cellDeep, honey, smoothstep(0.3, 0.75, fillLvl));
  let dome = 1.0 - smoothstep(0.0, 0.4, hexD);
  let glossy = smoothstep(0.6, 0.95, dome) * step(0.45, fillLvl);
  col = mix(col, honey * 1.3, glossy * 0.6);
  col = mix(col, wall, wallMask);
  let waxHi = smoothstep(0.46, 0.50, hexD);
  col = mix(col, wax, waxHi * 0.55);
  let drip = vertical_drips(uv, seed + 5.0, 0.75);
  col = mix(col, honey * 1.15, sat(drip) * 0.7);
  let bubble = speckle(px, 3.0, seed + 9.0, 0.965);
  col = mix(col, vec3f(0.99, 0.88, 0.52), bubble * 0.5);
  let shade = fbm(uv.x * 2.0 + seed, uv.y * 2.0, 2.0) * 0.5 + 0.5;
  col = col * (0.88 + shade * 0.24);
  return sat3(col);
}
