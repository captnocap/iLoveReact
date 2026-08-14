// @material algae_rust
// @slug algae-rust
// @name Algae Rust
// @board contraband
// @variant-labels Green Bloom, Green Mud, Oily Rust
// @kind surface
// @tags contraband, algae, rust, organic
// @author editor
fn algae_rust(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var slime = vec3f(0.28, 0.24, 0.19);
  var algae = vec3f(0.22, 0.52, 0.25);
  var rust = vec3f(0.58, 0.28, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    slime = vec3f(0.22, 0.20, 0.18);
    algae = vec3f(0.38, 0.74, 0.34);
    rust = vec3f(0.66, 0.35, 0.20);
  } else if (variant >= 1.5) {
    slime = vec3f(0.18, 0.13, 0.10);
    algae = vec3f(0.10, 0.35, 0.10);
    rust = vec3f(0.95, 0.48, 0.14);
  }
  let spread = fbm(uv.x * 3.8 + seed * 0.4, uv.y * 5.5 + seed, 5.0) * 0.5 + 0.5;
  let spots = speckle(px + vec2f(seed * 4.0, seed * 2.0), 2.8, seed + 9.0, 0.95);
  var col = mix(slime, algae, smoothstep(0.38, 0.72, spread));
  col = mix(col, rust, spots * 0.6);
  col = col + vec3f(0.06, 0.05, 0.03) * crack_field(uv, seed + 7.0, 11.0);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 1.7, seed + 13.0, 0.93);
  return sat3(col);
}
