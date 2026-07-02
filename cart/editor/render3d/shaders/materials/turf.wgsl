// @material turf
// @slug turf
// @name Turf
// @board second_pass
// @variant-labels Mowed Stripes, Clover Meadow, Dry Summer
// @kind surface
// @tags second_pass, turf
// @author legacy
fn turf(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Mowed lawn with stripe bands, clover patches, bare dirt, dandelions.
  let stripe = step(0.5, fract(uv.y * 7.0 + seed * 0.1));
  let stripe_blend = mix(1.0, 0.88, stripe);

  var lo = vec3f(0.10, 0.28, 0.08);
  var hi = vec3f(0.28, 0.52, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.14, 0.38, 0.18);
    hi = vec3f(0.38, 0.62, 0.28);
  } else if (variant >= 1.5) {
    lo = vec3f(0.28, 0.24, 0.08);
    hi = vec3f(0.52, 0.44, 0.16);
  }
  let tex = fbm(uv.x * 16.0 + seed, uv.y * 16.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(lo, hi, tex) * stripe_blend;

  let clover = speckle(px + vec2f(3.0, 9.0), 4.5, seed, 0.92);
  col = mix(col, vec3f(0.18, 0.42, 0.14), clover * 0.32);

  let bare = smoothstep(0.48, 0.68, fbm(uv.x * 5.0 - seed, uv.y * 5.0 + seed, 4.0) * 0.5 + 0.5);
  let dirt = mix(vec3f(0.38, 0.28, 0.16), vec3f(0.52, 0.40, 0.24), fbm(uv.x * 10.0, uv.y * 10.0, 4.0) * 0.5 + 0.5);
  col = mix(col, dirt, bare * 0.52);

  let dandelion = speckle(px + vec2f(19.0, 5.0), 8.0, seed, 0.96) * (1.0 - bare);
  col = mix(col, vec3f(0.92, 0.86, 0.14), dandelion * 0.50);
  return sat3(col);
}
