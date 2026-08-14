// @material carbon_veneer
// @slug carbon-veneer
// @name Carbon Veneer
// @board metal_yard
// @variant-labels Dry Veneer, Oiled Veneer, Coked Veneer
// @kind surface
// @tags metal_yard, carbon, veneer, matte
// @author editor
fn carbon_veneer(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.15, 0.16, 0.18);
  var shine = vec3f(0.80, 0.80, 0.82);
  var dust = vec3f(0.38, 0.37, 0.35);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.12, 0.13, 0.16);
    shine = vec3f(0.92, 0.91, 0.95);
    dust = vec3f(0.48, 0.46, 0.43);
  } else if (variant >= 1.5) {
    base = vec3f(0.22, 0.22, 0.25);
    shine = vec3f(0.63, 0.60, 0.62);
    dust = vec3f(0.72, 0.68, 0.65);
  }
  let weave = 1.0 - smoothstep(0.28, 0.35, abs(fract((uv.x * 10.0 + uv.y * 7.0) + seed * 0.2) - 0.5));
  let grit = crack_field(uv, seed + 3.0, 17.0);
  var col = mix(base, shine, smoothstep(0.23, 0.72, fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 4.0) * 0.5 + 0.5));
  col = mix(col, dust, (weave * 0.5) + (grit * 0.3));
  col = col + vec3f(0.04, 0.04, 0.04) * speckle(px, 2.2, seed + 8.0, 0.965);
  col = col - vec3f(0.06, 0.06, 0.06) * speckle(px, 1.5, seed + 14.0, 0.94);
  return sat3(col);
}
