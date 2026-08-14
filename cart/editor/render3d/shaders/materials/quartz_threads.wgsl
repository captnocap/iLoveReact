// @material quartz_threads
// @slug quartz-threads
// @name Quartz Threads
// @board wallpapers
// @variant-labels Quartz Light, Quartz Dense, Quartz Dense+Tinge
// @kind surface
// @tags wallpapers, quartz, thread, weave
// @author editor
fn quartz_threads(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.86, 0.84, 0.79);
  var thread = vec3f(0.69, 0.73, 0.80);
  var spark = vec3f(0.97, 0.96, 0.95);
  if (variant > 0.5 && variant < 1.5) {
    bg = vec3f(0.88, 0.86, 0.82);
    thread = vec3f(0.90, 0.88, 0.82);
    spark = vec3f(0.66, 0.62, 0.92);
  } else if (variant >= 1.5) {
    bg = vec3f(0.72, 0.70, 0.66);
    thread = vec3f(0.38, 0.42, 0.48);
    spark = vec3f(0.98, 0.84, 0.67);
  }
  let t1 = 1.0 - smoothstep(0.02, 0.04, abs(fract((uv.x + seed * 0.19) * 36.0) - 0.5));
  let t2 = 1.0 - smoothstep(0.02, 0.04, abs(fract((uv.y + seed * 0.16) * 16.0) - 0.5));
  let t = max(t1, t2);
  let noise = fbm(uv.x * 9.0 + seed, uv.y * 9.0 + seed * 0.7, 4.0) * 0.5 + 0.5;
  var col = mix(bg, thread, mix(0.28, 0.62, noise));
  col = mix(col, spark, t * (0.35 + noise * 0.1));
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 2.2, seed + 9.0, 0.968);
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 3.1, seed + 13.0, 0.93);
  return sat3(col);
}
