// @material woven_lace
// @slug woven-lace
// @name Woven Lace
// @board props
// @variant-labels Tight Weave, Loose Weave, Frayed Weave
// @kind surface
// @tags props, fabric, weave
// @author editor
fn woven_lace(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.78, 0.58, 0.38);
  var thread = vec3f(0.38, 0.26, 0.16);
  var wear = vec3f(0.12, 0.10, 0.08);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.72, 0.62, 0.46);
    thread = vec3f(0.31, 0.22, 0.14);
    wear = vec3f(0.16, 0.14, 0.10);
  } else if (variant >= 1.5) {
    base = vec3f(0.56, 0.44, 0.30);
    thread = vec3f(0.24, 0.15, 0.10);
    wear = vec3f(0.20, 0.18, 0.14);
  }
  let weave = abs(sin((uv.x + uv.y) * 84.0 + seed));
  let warp = 1.0 - smoothstep(0.20, 0.25, abs(fract((uv.y + seed * 0.17) * 18.0) - 0.5));
  let weft = 1.0 - smoothstep(0.20, 0.25, abs(fract((uv.x + seed * 0.12) * 18.0) - 0.5));
  let knots = 1.0 - smoothstep(0.18, 0.23, abs(fract((uv.x + uv.y + seed * 0.11) * 14.0) - 0.5));
  var col = mix(base, thread, (warp * 0.5 + weft * 0.5) * 0.85);
  let cross = smoothstep(0.40, 0.80, weave) * knots;
  col = mix(col, wear, cross * 0.5);
  col = col + vec3f(0.02, 0.02, 0.02) * crack_field(uv, seed + 7.0, 32.0);
  col = col - vec3f(0.04, 0.03, 0.02) * speckle(px, 2.0, seed + 4.0, 0.965);
  return sat3(col);
}
