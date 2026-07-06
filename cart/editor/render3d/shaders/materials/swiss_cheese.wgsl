// @material swiss_cheese
// @slug swiss-cheese
// @name Swiss Cheese
// @board props
// @variant-labels Deli Pale, Aged Golden, Smoked Wheel
// @kind surface
// @tags props, cheese, deli, holes
// @author fable-food
fn swiss_cheese(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.96, 0.86, 0.52);
  var shadow = vec3f(0.72, 0.56, 0.24);
  var hole = vec3f(0.52, 0.38, 0.14);
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.93, 0.72, 0.28);
    shadow = vec3f(0.66, 0.46, 0.14);
    hole = vec3f(0.44, 0.28, 0.08);
  } else if (variant >= 1.5) {
    body = vec3f(0.84, 0.62, 0.34);
    shadow = vec3f(0.56, 0.36, 0.16);
    hole = vec3f(0.32, 0.19, 0.08);
  }
  let wax = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5;
  var col = mix(body, shadow, wax * 0.28);
  var holeMask = 0.0;
  var rimMask = 0.0;
  for (var i = 0; i < 7; i = i + 1) {
    let fi = f32(i);
    let hx = rand(vec2f(fi * 3.1, seed * 0.7)) * 0.9 + 0.05;
    let hy = rand(vec2f(seed * 0.3, fi * 5.7)) * 0.9 + 0.05;
    let hr = 0.045 + rand(vec2f(fi, seed + 4.0)) * 0.075;
    let d = length((uv - vec2f(hx, hy)) * vec2f(1.0, 0.92));
    holeMask = max(holeMask, 1.0 - smoothstep(hr * 0.8, hr, d));
    rimMask = max(rimMask, (1.0 - smoothstep(hr, hr * 1.35, d)));
  }
  col = mix(col, body * 1.12, sat(rimMask - holeMask) * 0.8);
  let cave = smoothstep(0.2, 0.9, holeMask);
  col = mix(col, hole, cave);
  col = mix(col, hole * 0.6, smoothstep(0.75, 1.0, holeMask) * 0.7);
  let pit = speckle(px, 2.0, seed + 6.0, 0.965) * (1.0 - holeMask);
  col = mix(col, shadow, pit * 0.5);
  let sheenBand = smoothstep(0.5, 0.95, sin((uv.x - uv.y) * 5.0 + seed) * 0.5 + 0.5) * (1.0 - holeMask);
  col = mix(col, vec3f(0.99, 0.95, 0.74), sheenBand * 0.12);
  return sat3(col);
}
