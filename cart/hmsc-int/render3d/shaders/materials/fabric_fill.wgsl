// @material fabric_fill
// @slug fabric
// @name Fabric
// @board props
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags props, fabric
// @author legacy
fn fabric_fill(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let warp = line_near(sin((uv.x + fbm(uv.x * 2.0 + seed, uv.y * 2.0, 3.0) * 0.020) * 95.0), 0.10);
  let weft = line_near(sin((uv.y + fbm(uv.x * 2.0, uv.y * 2.0 - seed, 3.0) * 0.020) * 88.0), 0.11);
  let weave = sat(warp * 0.58 + weft * 0.48);
  var col = mix(vec3f(0.16, 0.22, 0.12), vec3f(0.48, 0.55, 0.34), weave);
  if (variant > 0.5 && variant < 1.5) {
    let stripe_a = line_near(sin(uv.x * 28.0), 0.13);
    let stripe_b = line_near(sin(uv.y * 19.0), 0.12);
    col = mix(vec3f(0.16, 0.08, 0.09), vec3f(0.70, 0.58, 0.42), weave * 0.40 + stripe_a * 0.32);
    col = mix(col, vec3f(0.08, 0.12, 0.17), stripe_b * 0.36);
  } else if (variant >= 1.5) {
    let camo_a = blotch(uv, vec2f(0.24, 0.36), 0.22, vec2f(1.4, 0.8), seed);
    let camo_b = blotch(uv, vec2f(0.70, 0.68), 0.20, vec2f(0.9, 1.5), seed + 5.0);
    let camo_c = blotch(uv, vec2f(0.58, 0.22), 0.15, vec2f(1.2, 1.0), seed + 8.0);
    col = mix(vec3f(0.18, 0.22, 0.14), vec3f(0.44, 0.40, 0.24), weave * 0.25);
    col = mix(col, vec3f(0.08, 0.13, 0.08), camo_a * 0.68);
    col = mix(col, vec3f(0.38, 0.31, 0.18), camo_b * 0.58);
    col = mix(col, vec3f(0.055, 0.060, 0.050), camo_c * 0.50);
  }
  col = col + vec3f((fbm(uv.x * 18.0 + seed, uv.y * 18.0, 4.0) - 0.5) * 0.070) - vec3f(speckle(px, 3.0, seed, 0.93) * 0.060);
  return sat3(col);
}
