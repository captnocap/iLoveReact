// @material peacock_eye
// @slug peacock-eye
// @name Peacock Eye
// @board props
// @variant-labels Royal Train, White Peafowl, Firebird
// @kind surface
// @tags props, feather, eye
// @author fable-creature_skins
fn peacock_eye(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var barbc = vec3f(0.05, 0.35, 0.16);
  var bronzec = vec3f(0.62, 0.42, 0.12);
  var tealc = vec3f(0.05, 0.55, 0.52);
  var eyec = vec3f(0.06, 0.12, 0.45);
  if (variant > 0.5 && variant < 1.5) {
    barbc = vec3f(0.88, 0.87, 0.82);
    bronzec = vec3f(0.72, 0.70, 0.62);
    tealc = vec3f(0.80, 0.80, 0.76);
    eyec = vec3f(0.55, 0.56, 0.58);
  } else if (variant >= 1.5) {
    barbc = vec3f(0.35, 0.08, 0.06);
    bronzec = vec3f(0.90, 0.55, 0.12);
    tealc = vec3f(0.75, 0.25, 0.08);
    eyec = vec3f(0.20, 0.04, 0.16);
  }
  let p = vec2f(uv.x * 3.0 + seed * 0.11, uv.y * 3.0 - seed * 0.07);
  let row = floor(p.y);
  let f = vec2f(fract(p.x + fract(row * 0.5)) - 0.5, fract(p.y) - 0.5);
  let r = length(f * vec2f(1.0, 1.25));
  let ang = atan2(f.y, f.x);
  let barbs = snoise(ang * 4.0 + seed, r * 16.0) * 0.5 + 0.5;
  var col = barbc * (0.75 + barbs * 0.5);
  let ray = line_near(fract(ang * 3.82) - 0.5, 0.18);
  col = col - vec3f(0.05, 0.08, 0.05) * ray * 0.5;
  col = mix(col, bronzec * (0.85 + barbs * 0.3), 1.0 - smoothstep(0.24, 0.33, r));
  col = mix(col, tealc, 1.0 - smoothstep(0.16, 0.23, r));
  col = mix(col, eyec, 1.0 - smoothstep(0.08, 0.14, r));
  col = mix(col, tealc * 1.3, 1.0 - smoothstep(0.0, 0.05, length(f - vec2f(0.02, -0.03))));
  col = col + vec3f(0.10, 0.12, 0.08) * speckle(px, 2.0, seed, 0.95);
  return sat3(col);
}
