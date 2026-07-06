// @material clover_patch
// @slug clover-patch
// @name Clover Patch
// @board environment
// @variant-labels White Bloom, Deep Shamrock, Dry Lawn
// @kind surface
// @tags environment, clover, groundcover
// @author fable-botanic
fn clover_patch(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var leaf_lo = vec3f(0.07, 0.24, 0.09);
  var leaf_hi = vec3f(0.22, 0.50, 0.16);
  var bloom_c = vec3f(0.94, 0.94, 0.88);
  var bloom_amt = 0.85;
  if (variant > 0.5 && variant < 1.5) {
    leaf_lo = vec3f(0.03, 0.17, 0.08);
    leaf_hi = vec3f(0.12, 0.40, 0.15);
    bloom_c = vec3f(0.88, 0.72, 0.84);
    bloom_amt = 0.35;
  } else if (variant >= 1.5) {
    leaf_lo = vec3f(0.18, 0.22, 0.08);
    leaf_hi = vec3f(0.42, 0.46, 0.16);
    bloom_c = vec3f(0.80, 0.76, 0.60);
    bloom_amt = 0.5;
  }
  let v = voronoi(uv.x * 24.0 + seed, uv.y * 24.0 + seed * 0.4);
  let leafm = smoothstep(0.50, 0.18, v.x);
  let shade = fract(v.y * 5.71);
  var col = mix(leaf_lo * 0.55, mix(leaf_lo, leaf_hi, shade), leafm);
  let lobe = 0.5 + 0.5 * sin(v.x * 42.0 + v.y * 3.0);
  col = col + vec3f(0.04, 0.09, 0.03) * lobe * leafm;
  let crease = line_near(sin((uv.x - uv.y) * 90.0 + seed), 0.14);
  col = mix(col, leaf_lo * 0.7, crease * 0.35 * leafm);
  let bv = voronoi(uv.x * 8.0 + seed * 1.3, uv.y * 8.0);
  let puff = smoothstep(0.14, 0.05, bv.x) * step(0.72, fract(bv.y * 9.31));
  col = mix(col, bloom_c, puff * bloom_amt);
  let pufftx = speckle(px, 2.0, seed + 7.0, 0.80);
  col = mix(col, bloom_c * 0.82, puff * bloom_amt * pufftx * 0.7);
  let soil = fbm(uv.x * 4.0 + seed * 2.0, uv.y * 4.0, 3.0) * 0.5 + 0.5;
  col = col * (0.85 + soil * 0.25);
  return sat3(col);
}
