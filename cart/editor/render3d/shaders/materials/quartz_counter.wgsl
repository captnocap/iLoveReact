// @material quartz_counter
// @slug quartz-counter
// @name Quartz Counter
// @board liminal
// @variant-labels Showroom White, Cool Grey, Midnight Slab
// @kind surface
// @tags liminal, counter, kitchen, stone
// @author fable-interior_home
fn quartz_counter(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.92, 0.91, 0.88);
  var vein_tone = vec3f(0.55, 0.56, 0.60);
  var fleck_tone = vec3f(0.72, 0.70, 0.66);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.85, 0.87, 0.89);
    vein_tone = vec3f(0.40, 0.45, 0.54);
    fleck_tone = vec3f(0.64, 0.68, 0.74);
  } else if (variant >= 1.5) {
    base = vec3f(0.20, 0.21, 0.24);
    vein_tone = vec3f(0.62, 0.60, 0.56);
    fleck_tone = vec3f(0.42, 0.42, 0.46);
  }
  let warp = fbm(uv.x * 3.0 + seed * 0.13, uv.y * 3.0 - seed * 0.07, 3.0);
  let v1 = abs(snoise(uv.x * 2.3 + warp * 1.6 + seed * 0.31, uv.y * 2.1 + seed * 0.11));
  let v2 = abs(snoise(uv.x * 4.7 - seed * 0.23, uv.y * 4.4 + warp * 1.1));
  let vein_a = 1.0 - smoothstep(0.005, 0.10, v1);
  let vein_b = 1.0 - smoothstep(0.0, 0.05, v2);
  let grain = fbm(uv.x * 9.0 + seed, uv.y * 9.0, 3.0) * 0.5 + 0.5;
  var col = base + vec3f((grain - 0.5) * 0.08);
  col = mix(col, vein_tone, vein_a * 0.5);
  col = mix(col, vein_tone * 0.85, vein_b * 0.35);
  col = mix(col, fleck_tone, speckle(px, 2.0, seed, 0.90) * 0.6);
  col = col + vec3f(0.05, 0.05, 0.05) * smoothstep(0.55, 0.0, uv.y + snoise(uv.x * 2.0, seed) * 0.1);
  return sat3(col);
}
