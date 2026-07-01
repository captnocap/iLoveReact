// @material sidewalk
// @slug sidewalk
// @name Sidewalk
// @board second_pass
// @variant-labels Grey, Terracotta, Flagstone
// @kind surface
// @tags second_pass, sidewalk
// @author legacy
fn sidewalk(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Poured concrete slabs with irregular widths, expansion joints, rebar rust
  // drips, gum spots, and leaf stains.
  let row = floor(uv.y * 4.0);
  let ywarp = sin(uv.x * 3.0 + row + seed) * 0.006;
  let local_y = fract(uv.y * 4.0 + ywarp);
  let joint_y = 1.0 - smoothstep(0.012, 0.032, min(local_y, 1.0 - local_y));

  let slab_x = fract(uv.x * 2.0 + rand(vec2f(row, seed + 1.0)) * 0.3);
  let joint_x = 1.0 - smoothstep(0.010, 0.028, min(slab_x, 1.0 - slab_x));
  let joints = sat(joint_x + joint_y);

  var col = mix(vec3f(0.55, 0.53, 0.50), vec3f(0.72, 0.70, 0.66), fbm(uv.x * 12.0 + seed, uv.y * 12.0, 5.0) * 0.5 + 0.5);

  let rust_drip = vertical_drips(uv + vec2f(0.05, 0.0), seed + 7.0, 0.6) * joint_x;
  col = mix(col, vec3f(0.42, 0.22, 0.10), rust_drip * 0.55);

  let gum = speckle(px, 5.0, seed + 3.0, 0.96) * smoothstep(0.2, 0.8, fbm(uv.x * 4.0, uv.y * 4.0 + seed, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.75, 0.20, 0.35), gum * 0.62);

  let leaf = blotch(uv, vec2f(0.24, 0.72), 0.14, vec2f(1.3, 0.7), seed + 2.0) + blotch(uv, vec2f(0.68, 0.38), 0.12, vec2f(0.8, 1.2), seed + 5.0);
  col = mix(col, vec3f(0.42, 0.35, 0.18), sat(leaf) * 0.32);

  col = mix(col, vec3f(0.35, 0.33, 0.30), joints * 0.78);

  if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.68, 0.42, 0.32), 0.18);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.78, 0.72, 0.58), 0.15);
  }
  return sat3(col - vec3f(speckle(px, 3.0, seed, 0.92) * 0.06));
}
