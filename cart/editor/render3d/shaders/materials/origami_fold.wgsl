// @material origami_fold
// @slug origami-fold
// @name Origami Fold
// @board wallpapers
// @variant-labels Crane Red, Pastel Petal, Gold Foil
// @kind surface
// @tags wallpapers, origami, fold, facets
// @author fable-paper_print
fn origami_fold(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.80, 0.28, 0.26);
  var lite = vec3f(0.92, 0.52, 0.46);
  var deep = vec3f(0.52, 0.16, 0.18);
  if (variant > 0.5 && variant < 1.5) { base = vec3f(0.86, 0.74, 0.82); lite = vec3f(0.95, 0.88, 0.92); deep = vec3f(0.62, 0.50, 0.64); }
  else if (variant >= 1.5) { base = vec3f(0.78, 0.62, 0.26); lite = vec3f(0.94, 0.84, 0.48); deep = vec3f(0.50, 0.36, 0.14); }
  let p = uv - vec2f(0.5, 0.5);
  let d1 = p.x + p.y;
  let d2 = p.x - p.y;
  var facet = 0.0;
  facet = facet + step(0.0, p.x) * 1.0;
  facet = facet + step(0.0, p.y) * 2.0;
  facet = facet + step(0.0, d1) * 4.0;
  facet = facet + step(0.0, d2) * 8.0;
  let fr = rand(vec2f(facet, seed));
  var col = mix(deep, lite, 0.30 + fr * 0.55);
  col = mix(col, base, 0.40);
  let grain = fbm(uv.x * 46.0 + facet * 7.0, uv.y * 46.0 + seed, 2.0) + 0.5;
  col = mix(col, lite, grain * 0.10);
  let c1 = line_near(p.x, 0.006);
  let c2 = line_near(p.y, 0.006);
  let c3 = line_near(d1, 0.006);
  let c4 = line_near(d2, 0.006);
  col = mix(col, deep, sat(c1 + c3) * 0.5);
  col = mix(col, lite * 1.1, sat(c2 + c4) * 0.45);
  let quar = min(abs(p.x), abs(p.y));
  let petal = line_near(length(abs(p) - vec2f(0.25, 0.25)) - 0.14, 0.008);
  col = mix(col, deep, petal * 0.35);
  let shade = smoothstep(0.75, 0.15, length(p)) * 0.12;
  col = col + vec3f(shade * 0.4) - vec3f(quar * 0.06);
  if (variant >= 1.5) {
    let sheen = pow(sat(0.5 + snoise(uv.x * 4.0 + seed, uv.y * 4.0) * 0.5), 2.5);
    col = mix(col, vec3f(0.98, 0.92, 0.66), sheen * 0.30);
  }
  col = col - vec3f(speckle(px, 2.0, seed + 6.0, 0.993) * 0.08);
  return sat3(col);
}
