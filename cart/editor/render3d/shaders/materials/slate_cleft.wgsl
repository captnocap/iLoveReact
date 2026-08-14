// @material slate_cleft
// @slug slate-cleft
// @name Cleft Slate
// @board wood_brick_stone
// @variant-labels Blue Ridge, Rust Seep, Vermont Green
// @kind surface
// @tags wood_brick_stone, slate, stone, layered
// @author fable-geology
fn slate_cleft(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.16, 0.18, 0.22);
  var hi = vec3f(0.38, 0.42, 0.48);
  var stain = vec3f(0.30, 0.34, 0.40);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.18, 0.16, 0.15);
    hi = vec3f(0.40, 0.36, 0.32);
    stain = vec3f(0.52, 0.30, 0.14);
  } else if (variant >= 1.5) {
    lo = vec3f(0.14, 0.20, 0.17);
    hi = vec3f(0.34, 0.44, 0.38);
    stain = vec3f(0.24, 0.32, 0.26);
  }
  let warp = fbm(uv.x * 3.0 + seed * 0.7, uv.y * 7.0 - seed * 0.3, 3.0);
  let layer_v = uv.y * 9.0 + warp * 1.1 + seed * 0.31;
  let layer_id = floor(layer_v);
  let band = fract(layer_v);
  let tone = rand(vec2f(layer_id, floor(seed * 0.7)));
  var col = mix(lo, hi, tone);
  let streak = fbm(uv.x * 26.0 + layer_id * 5.0 + seed, uv.y * 3.0, 3.0);
  col = col * (0.88 + streak * 0.42);
  col = mix(col, lo * 0.5, smoothstep(0.12, 0.0, band) * 0.8);
  let chip_gate = step(0.6, rand(vec2f(layer_id, floor(uv.x * 7.0) + seed)));
  col = mix(col, hi * 1.25, smoothstep(0.10, 0.02, abs(band - 0.16)) * chip_gate * 0.7);
  col = mix(col, stain, sat(vertical_drips(uv, seed + 5.0, 0.8)) * 0.35);
  col = mix(col, hi * 1.1, speckle(px, 2.0, seed + 9.0, 0.982) * 0.5);
  return sat3(col);
}
