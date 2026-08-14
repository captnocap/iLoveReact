// @material rust_wave
// @slug rust-wave
// @name Rust Wave
// @board liminal
// @variant-labels Surface Rust, Sheen Rust, Melt Rust
// @kind surface
// @tags liminal, rust, wave, weather
// @author editor
fn rust_wave(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.38, 0.28, 0.21);
  var rust = vec3f(0.86, 0.38, 0.17);
  var pat = vec3f(0.10, 0.08, 0.06);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.32, 0.23, 0.18);
    rust = vec3f(0.94, 0.60, 0.20);
    pat = vec3f(0.16, 0.12, 0.09);
  } else if (variant >= 1.5) {
    base = vec3f(0.54, 0.34, 0.20);
    rust = vec3f(1.00, 0.34, 0.08);
    pat = vec3f(0.44, 0.22, 0.12);
  }
  let foam = 1.0 - smoothstep(0.05, 0.09, abs(fract((uv.x + uv.y * 1.6 + seed) * 26.0) - 0.5));
  let wave = 0.5 + 0.5 * sin((uv.x + uv.y) * 15.0 + sin(U.time * 1.1) * 0.8 + seed);
  var col = mix(base, rust, foam * (0.3 + 0.3 * wave));
  col = mix(col, pat, crack_field(uv, seed + 8.0, 19.0));
  col = col + vec3f(0.06, 0.03, 0.02) * speckle(px, 2.0, seed + 5.0, 0.97);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 2.8, seed + 13.0, 0.936);
  return sat3(col);
}
