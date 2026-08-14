// @material bread_crust
// @slug bread-crust
// @name Bread Crust
// @board props
// @variant-labels Country Loaf, Dark Bake, Rye Seeded
// @kind surface
// @tags props, bread, bakery, crust
// @author fable-food
fn bread_crust(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var crust = vec3f(0.72, 0.44, 0.18);
  var burn = vec3f(0.38, 0.19, 0.07);
  var inner = vec3f(0.95, 0.86, 0.66);
  var dust = vec3f(0.97, 0.94, 0.86);
  if (variant > 0.5 && variant < 1.5) {
    crust = vec3f(0.50, 0.26, 0.09);
    burn = vec3f(0.22, 0.10, 0.04);
    inner = vec3f(0.88, 0.74, 0.50);
    dust = vec3f(0.92, 0.88, 0.80);
  } else if (variant >= 1.5) {
    crust = vec3f(0.46, 0.30, 0.16);
    burn = vec3f(0.26, 0.15, 0.08);
    inner = vec3f(0.80, 0.66, 0.44);
    dust = vec3f(0.90, 0.86, 0.76);
  }
  let bump = fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0) * 0.5 + 0.5;
  let blister = fbm(uv.x * 22.0 + seed * 1.7, uv.y * 22.0, 3.0) * 0.5 + 0.5;
  var col = mix(crust, burn, smoothstep(0.35, 0.85, bump));
  col = mix(col, crust * 1.15, smoothstep(0.62, 0.9, blister) * 0.5);
  let cut1 = segment_mark(uv, vec2f(0.18, 0.30), vec2f(0.82, 0.22), 0.030);
  let cut2 = segment_mark(uv, vec2f(0.16, 0.56), vec2f(0.84, 0.48), 0.030);
  let cut3 = segment_mark(uv, vec2f(0.20, 0.80), vec2f(0.80, 0.74), 0.026);
  let score = max(max(cut1, cut2), cut3);
  let bloom = max(max(segment_mark(uv, vec2f(0.18, 0.27), vec2f(0.82, 0.19), 0.052), segment_mark(uv, vec2f(0.16, 0.53), vec2f(0.84, 0.45), 0.052)), segment_mark(uv, vec2f(0.20, 0.77), vec2f(0.80, 0.71), 0.046));
  col = mix(col, crust * 1.25, bloom * 0.6);
  col = mix(col, inner, score * 0.9);
  let flour = speckle(px, 3.0, seed + 5.0, 0.90) * smoothstep(0.3, 0.7, bump);
  col = mix(col, dust, flour * 0.55);
  if (variant >= 1.5) {
    let seedSpeck = speckle(px, 4.0, seed + 21.0, 0.93);
    col = mix(col, vec3f(0.12, 0.09, 0.06), seedSpeck * 0.8);
  }
  let shade = fbm(uv.x * 2.5 + seed, uv.y * 2.5, 2.0) * 0.5 + 0.5;
  col = col * (0.88 + shade * 0.22);
  return sat3(col);
}
