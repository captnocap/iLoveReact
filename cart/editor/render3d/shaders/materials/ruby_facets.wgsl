// @material ruby_facets
// @slug ruby-facets
// @name Ruby Facets
// @board neon_surface
// @variant-labels Pigeon Blood, Rose Cut, Dark Garnet Fire
// @kind surface
// @tags neon_surface, ruby, facets, red
// @author fable-gems_precious
fn ruby_facets(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.72, 0.06, 0.16);
  var deep_t = vec3f(0.32, 0.01, 0.06);
  var fire = vec3f(1.0, 0.42, 0.32);
  var sc = 5.0;
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.82, 0.20, 0.32); deep_t = vec3f(0.42, 0.06, 0.14); sc = 8.0;
  } else if (variant >= 1.5) {
    body = vec3f(0.48, 0.03, 0.12); deep_t = vec3f(0.18, 0.01, 0.05);
    fire = vec3f(0.92, 0.30, 0.18); sc = 4.0;
  }
  let a = (uv.x + uv.y) * sc + seed * 0.11;
  let b = (uv.x - uv.y) * sc;
  let ia = floor(a); let ib = floor(b);
  let fa = fract(a); let fb = fract(b);
  let half_pick = step(fb, fa);
  let fid = rand(vec2f(ia * 7.1 + half_pick, ib * 3.3 + seed * 0.01));
  var col = mix(deep_t, body, 0.30 + 0.70 * fid);
  let edge = min(min(fa, 1.0 - fa), min(fb, 1.0 - fb));
  let diag = abs(fa - fb);
  let junction = min(edge, diag * 0.7);
  col = mix(vec3f(0.95, 0.80, 0.82), col, smoothstep(0.0, 0.05, junction));
  let glow = exp(-length(uv - vec2f(0.5, 0.45)) * 2.2);
  col = mix(col, fire, glow * 0.40);
  let hot_facet = step(0.86, fid);
  col = mix(col, fire * 1.1, hot_facet * 0.5);
  col += vec3f(1.0, 0.85, 0.85) * speckle(px, 2.0, seed, 0.996) * 0.4;
  return sat3(col);
}
