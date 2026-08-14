// @material blood_pool
// @slug blood-pool
// @name Blood Pool
// @board contraband
// @variant-labels Fresh, Dried, Smear
// @kind surface
// @tags contraband, blood, pool
// @author legacy
fn blood_pool(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Crime-scene spatter on a floor — what a MurderEvent leaves. 0 fresh (wet
  // specular), 1 dried (brown matte), 2 smear (directional drag).
  let floor_c = mix(vec3f(0.10, 0.10, 0.11), vec3f(0.16, 0.16, 0.17), fbm(uv.x * 14.0 + seed, uv.y * 14.0, 4.0) * 0.5 + 0.5);
  let blood = vec3f(0.34, 0.02, 0.02);
  var col = floor_c;
  let pool = blotch(uv, vec2f(0.5, 0.5), 0.26, vec2f(1.0, 0.85), seed);
  col = mix(col, blood, pool);
  let drops = sat(dot_mark(uv, vec2f(0.22, 0.30), 0.04) + dot_mark(uv, vec2f(0.78, 0.36), 0.03) + dot_mark(uv, vec2f(0.30, 0.78), 0.025) + dot_mark(uv, vec2f(0.70, 0.72), 0.035));
  col = mix(col, blood, drops);
  if (variant < 0.5) {
    let spec = 1.0 - smoothstep(0.0, 0.08, length((uv - vec2f(0.44, 0.44)) * vec2f(1.0, 1.0)));
    col = col + vec3f(0.5, 0.3, 0.3) * spec * pool;
    col = mix(col, vec3f(0.55, 0.03, 0.03), pool * 0.4);
  } else if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.20, 0.05, 0.03), (pool + drops) * 0.6);
  } else {
    let smear = blotch(uv, vec2f(0.5, 0.5), 0.30, vec2f(0.5, 1.6), seed) * smoothstep(0.5, 0.9, uv.y);
    col = mix(col, vec3f(0.28, 0.03, 0.03), smear * 0.7);
  }
  return sat3(col);
}
