// @material graphite_sheen
// @slug graphite-sheen
// @name Graphite Sheen
// @board liminal
// @variant-labels Soft Sheen, Dusted Sheen, Oily Sheen
// @kind surface
// @tags liminal, graphite, sheeting, sheen
// @author editor
fn graphite_sheen(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.21, 0.22, 0.24);
  var dust = vec3f(0.55, 0.55, 0.56);
  var sheen = vec3f(0.85, 0.85, 0.88);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.19, 0.19, 0.22);
    dust = vec3f(0.49, 0.50, 0.52);
    sheen = vec3f(0.74, 0.76, 0.79);
  } else if (variant >= 1.5) {
    base = vec3f(0.16, 0.16, 0.18);
    dust = vec3f(0.38, 0.41, 0.44);
    sheen = vec3f(0.95, 0.88, 0.80);
  }
  let grain = fbm(uv.x * 12.0 + seed, uv.y * 16.0 + seed * 0.6, 4.0) * 0.5 + 0.5;
  let lines = 1.0 - smoothstep(0.11, 0.15, abs(sin(uv.y * 70.0 + seed * 2.0) - 0.5));
  var col = mix(base, dust, smoothstep(0.36, 0.70, grain));
  col = mix(col, sheen, lines * (0.28 + grain * 0.25));
  col = col + vec3f(0.03, 0.03, 0.03) * crack_field(uv, seed + 9.0, 10.0) * 0.5;
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 2.1, seed + 3.0, 0.94);
  return sat3(col);
}
