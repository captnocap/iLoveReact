// @material shale_layers
// @slug shale-layers
// @name Layered Shale
// @board wood_brick_stone
// @variant-labels Grey Flake, Oil Brown, Rust Weathered
// @kind surface
// @tags wood_brick_stone, shale, layered, flaky
// @author fable-geology
fn shale_layers(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.17, 0.17, 0.18);
  var hi = vec3f(0.40, 0.40, 0.42);
  var stain = vec3f(0.34, 0.32, 0.30);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.18, 0.14, 0.10);
    hi = vec3f(0.42, 0.34, 0.24);
    stain = vec3f(0.30, 0.22, 0.12);
  } else if (variant >= 1.5) {
    lo = vec3f(0.22, 0.19, 0.17);
    hi = vec3f(0.46, 0.42, 0.38);
    stain = vec3f(0.56, 0.32, 0.14);
  }
  let warp = fbm(uv.x * 4.0 + seed * 0.5, uv.y * 10.0, 3.0);
  let lam = uv.y * 24.0 + warp * 0.7 + seed * 0.41;
  let lam_id = floor(lam);
  let bt = rand(vec2f(lam_id, floor(seed * 0.6)));
  var col = mix(lo, hi, bt);
  col = mix(col, lo * 0.5, smoothstep(0.16, 0.0, fract(lam)) * 0.75);
  let seg = floor(uv.x * 9.0 + rand(vec2f(lam_id, 5.5)) * 9.0);
  let flake = step(0.62, rand(vec2f(lam_id + seg * 13.0, seed * 0.08)));
  col = mix(col, hi * 1.3, smoothstep(0.10, 0.02, abs(fract(lam) - 0.22)) * flake * 0.65);
  let streak = fbm(uv.x * 40.0 + lam_id * 4.0 - seed, uv.y * 5.0, 3.0);
  col = col * (0.90 + streak * 0.32);
  col = mix(col, stain, sat(vertical_drips(uv, seed + 4.0, 0.9)) * 0.4);
  col = mix(col, lo * 0.6, speckle(px, 2.0, seed + 9.0, 0.982) * 0.5);
  return sat3(col);
}
