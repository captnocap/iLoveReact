// @material prism_rust
// @slug prism-rust
// @name Prism Rust
// @board contraband
// @variant-labels Dust Rust, Glitter Rust, Crystal Rust
// @kind surface
// @tags contraband, rust, prism, fracture
// @author editor
fn prism_rust(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.31, 0.24, 0.20);
  var prism = vec3f(0.94, 0.66, 0.31);
  var bloom = vec3f(0.90, 0.20, 0.06);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.38, 0.30, 0.24);
    prism = vec3f(0.99, 0.84, 0.40);
    bloom = vec3f(0.85, 0.34, 0.10);
  } else if (variant >= 1.5) {
    base = vec3f(0.26, 0.19, 0.15);
    prism = vec3f(1.00, 0.74, 0.95);
    bloom = vec3f(0.64, 0.06, 0.30);
  }
  let grain = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 5.0) * 0.5 + 0.5;
  let facets = 1.0 - smoothstep(0.11, 0.19, abs(sin(uv.x * 45.0 + uv.y * 18.0 + seed)));
  var col = mix(base, prism, smoothstep(0.30, 0.72, grain));
  col = mix(col, bloom, facets * 0.55);
  col = col + vec3f(0.03, 0.03, 0.03) * crack_field(uv, seed + 2.0, 16.0) * (0.45 + grain * 0.2);
  col = col - vec3f(0.06, 0.06, 0.06) * speckle(px, 2.2, seed + 10.0, 0.934);
  return sat3(col);
}
