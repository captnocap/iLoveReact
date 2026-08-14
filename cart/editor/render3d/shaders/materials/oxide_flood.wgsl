// @material oxide_flood
// @slug oxide-flood
// @name Oxide Flood
// @board metal_yard
// @variant-labels Mild Rust, Wet Rust, Powder Rust
// @kind surface
// @tags metal_yard, oxide, rust, flood
// @author editor
fn oxide_flood(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.28, 0.28, 0.30);
  var rust = vec3f(0.64, 0.28, 0.10);
  var stain = vec3f(0.90, 0.86, 0.73);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.34, 0.31, 0.33);
    rust = vec3f(0.76, 0.40, 0.18);
    stain = vec3f(0.75, 0.62, 0.52);
  } else if (variant >= 1.5) {
    base = vec3f(0.20, 0.20, 0.21);
    rust = vec3f(0.84, 0.24, 0.16);
    stain = vec3f(0.98, 0.80, 0.58);
  }
  let rustMask = fbm(uv.x * 6.0 + seed, uv.y * 6.0 - seed, 4.0) * 0.5 + 0.5;
  let vein = line_near(uv.x * 16.0 + cos(uv.y * 9.0 + seed) * 0.2, 0.02);
  var col = mix(base, rust, smoothstep(0.35, 0.75, rustMask));
  col = mix(col, stain, vein * 0.28);
  col = mix(col, vec3f(0.95, 0.95, 0.96), crack_field(uv, seed + 3.0, 14.0) * 0.32);
  col = col + vec3f(0.04, 0.02, 0.01) * speckle(px, 1.8, seed + 7.0, 0.93);
  return sat3(col);
}

