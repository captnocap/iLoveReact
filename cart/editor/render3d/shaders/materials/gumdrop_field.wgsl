// @material gumdrop_field
// @slug gumdrop-field
// @name Gumdrop Field
// @board props
// @variant-labels Pastel Party, Bold Fruit, Midnight Candy
// @kind surface
// @tags props, candy, gumdrop, sweet
// @author fable-food
fn gumdrop_field(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let sc = 5.0;
  let vr = voronoi(uv.x * sc + seed * 0.37, uv.y * sc + seed * 0.61);
  let dome = 1.0 - smoothstep(0.0, 0.62, vr.x);
  let id = fract(vr.y * 7.31 + seed * 0.113);
  var bg = vec3f(0.93, 0.88, 0.80);
  var c0 = vec3f(0.95, 0.55, 0.65);
  var c1 = vec3f(0.60, 0.85, 0.65);
  var c2 = vec3f(0.98, 0.82, 0.45);
  var c3 = vec3f(0.62, 0.70, 0.94);
  if (variant > 0.5 && variant < 1.5) {
    bg = vec3f(0.96, 0.93, 0.86);
    c0 = vec3f(0.90, 0.14, 0.20);
    c1 = vec3f(0.15, 0.65, 0.30);
    c2 = vec3f(0.98, 0.60, 0.08);
    c3 = vec3f(0.45, 0.20, 0.75);
  } else if (variant >= 1.5) {
    bg = vec3f(0.16, 0.12, 0.20);
    c0 = vec3f(0.85, 0.25, 0.55);
    c1 = vec3f(0.25, 0.75, 0.70);
    c2 = vec3f(0.90, 0.75, 0.25);
    c3 = vec3f(0.50, 0.35, 0.90);
  }
  var drop = c0;
  if (id > 0.25 && id <= 0.5) { drop = c1; }
  if (id > 0.5 && id <= 0.75) { drop = c2; }
  if (id > 0.75) { drop = c3; }
  var col = mix(bg, drop, smoothstep(0.12, 0.30, dome));
  col = col * (0.72 + dome * 0.42);
  let shine = smoothstep(0.80, 0.97, dome);
  col = mix(col, vec3f(1.0, 0.98, 0.95), shine * 0.5);
  let sugar = speckle(px, 2.0, seed + 9.0, 0.955);
  col = mix(col, vec3f(0.99, 0.97, 0.94), sugar * 0.55);
  let shade = fbm(uv.x * 3.0 + seed, uv.y * 3.0, 2.0) * 0.5 + 0.5;
  col = col * (0.92 + shade * 0.14);
  return sat3(col);
}
