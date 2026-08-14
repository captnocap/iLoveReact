// @material rusted_bolt
// @slug rusted-bolt
// @name Rusted Bolt
// @board metal_yard
// @variant-labels Oxide, Crushed, Corroded
// @kind surface
// @tags metal_yard, rust, bolt, hardware
// @author editor
fn rusted_bolt(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var steel = vec3f(0.20, 0.21, 0.23);
  var flash = vec3f(0.90, 0.90, 0.94);
  var rust = vec3f(0.57, 0.23, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    steel = vec3f(0.16, 0.17, 0.20);
    flash = vec3f(1.00, 0.98, 0.91);
    rust = vec3f(0.78, 0.30, 0.15);
  } else if (variant >= 1.5) {
    steel = vec3f(0.10, 0.11, 0.14);
    flash = vec3f(0.72, 0.78, 0.82);
    rust = vec3f(0.95, 0.40, 0.12);
  }
  let rings = 1.0 - smoothstep(0.20, 0.26, abs(sin(uv.x * 40.0 + seed + uv.y * 10.0)));
  let wear = crack_field(uv, seed + 3.0, 16.0);
  var col = mix(steel, flash, smoothstep(0.34, 0.72, fbm(uv.x * 8.0 + seed, uv.y * 8.0 - seed, 5.0) * 0.5 + 0.5));
  col = mix(col, rust, rings * 0.5 + wear * 0.45);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 2.1, seed + 6.0, 0.96);
  col = col - vec3f(0.03, 0.03, 0.03) * speckle(px, 1.7, seed + 12.0, 0.93);
  return sat3(col);
}
