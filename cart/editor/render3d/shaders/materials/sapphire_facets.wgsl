// @material sapphire_facets
// @slug sapphire-facets
// @name Sapphire Brilliant
// @board neon_surface
// @variant-labels Kashmir Blue, Star Silver, Ink Velvet
// @kind surface
// @tags neon_surface, sapphire, facets, blue
// @author fable-gems_precious
fn sapphire_facets(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.10, 0.22, 0.72);
  var deep_t = vec3f(0.03, 0.07, 0.34);
  var spark = vec3f(0.72, 0.85, 1.0);
  var wedges = 14.0;
  var star = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.28, 0.40, 0.72); deep_t = vec3f(0.10, 0.16, 0.38); star = 1.0; wedges = 10.0;
  } else if (variant >= 1.5) {
    body = vec3f(0.06, 0.10, 0.44); deep_t = vec3f(0.01, 0.03, 0.16);
    spark = vec3f(0.50, 0.66, 0.94); wedges = 18.0;
  }
  let d = uv - vec2f(0.5, 0.5);
  let r = length(d) * 2.1;
  let ang = atan2(d.y, d.x);
  let wedge = floor((ang / 6.28318 + 0.5) * wedges);
  let ring = floor(r * 4.0);
  let fid = rand(vec2f(wedge * 3.7 + ring * 11.3, seed * 0.05));
  var col = mix(deep_t, body, 0.30 + 0.70 * fid);
  let wedge_f = fract((ang / 6.28318 + 0.5) * wedges);
  let spoke = line_near(wedge_f - 0.5, 0.08);
  col = mix(col, spark, spoke * 0.35 * step(0.2, r));
  let ring_f = fract(r * 4.0);
  col = mix(col, spark * 0.8, line_near(ring_f - 0.5, 0.06) * 0.3);
  let girdle = smoothstep(0.92, 1.0, r);
  col = mix(col, deep_t * 0.6, girdle);
  let star_m = line_near(sin(ang * 3.0 + seed), 0.05) * exp(-r * 1.2) * star;
  col = mix(col, spark, star_m * 0.7);
  col = mix(col, spark, exp(-r * 3.5) * 0.35);
  col += spark * speckle(px, 2.0, seed, 0.995) * 0.45;
  return sat3(col);
}
