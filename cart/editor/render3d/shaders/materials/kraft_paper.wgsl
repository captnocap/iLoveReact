// @material kraft_paper
// @slug kraft-paper
// @name Kraft Paper
// @board wallpapers
// @variant-labels Fresh Sheet, Crumpled Wrap, Waxed Parcel
// @kind surface
// @tags wallpapers, kraft, paper, fiber
// @author fable-paper_print
fn kraft_paper(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var tone = vec3f(0.68, 0.52, 0.34);
  var dark = vec3f(0.46, 0.34, 0.22);
  var lite = vec3f(0.80, 0.66, 0.46);
  if (variant > 0.5 && variant < 1.5) { tone = vec3f(0.62, 0.46, 0.30); dark = vec3f(0.40, 0.29, 0.19); lite = vec3f(0.74, 0.58, 0.40); }
  else if (variant >= 1.5) { tone = vec3f(0.72, 0.58, 0.38); dark = vec3f(0.52, 0.40, 0.26); lite = vec3f(0.86, 0.74, 0.54); }
  let fiber = fbm(uv.x * 90.0, uv.y * 14.0 + seed, 3.0) + 0.5;
  let wash = fbm(uv.x * 5.0 + seed * 0.3, uv.y * 5.0, 3.0) + 0.5;
  var col = mix(dark, lite, sat(0.30 + fiber * 0.35 + wash * 0.35));
  col = mix(col, tone, 0.45);
  let vfold = line_near(uv.x - 0.34, 0.006);
  let vlit = line_near(uv.x - 0.328, 0.008);
  let hfold = line_near(uv.y - 0.62, 0.006);
  let hlit = line_near(uv.y - 0.608, 0.008);
  col = mix(col, dark, sat(vfold + hfold) * 0.5);
  col = mix(col, lite, sat(vlit + hlit) * 0.4);
  var crum = 0.0;
  if (variant > 0.5 && variant < 1.5) { crum = 1.0; }
  let wrk = snoise(uv.x * 7.0 + seed, uv.y * 7.0);
  let wrinkle = line_near(wrk, 0.10);
  col = mix(col, dark, wrinkle * 0.30 * crum);
  let wrk2 = snoise(uv.x * 13.0, uv.y * 13.0 + seed * 1.7);
  col = mix(col, lite, line_near(wrk2, 0.08) * 0.22 * crum);
  if (variant >= 1.5) {
    let sheen = pow(sat(0.5 + snoise(uv.x * 3.0 + seed, uv.y * 3.0) * 0.5), 3.0);
    col = mix(col, lite, sheen * 0.35);
  }
  col = col - vec3f(speckle(px, 2.0, seed, 0.982) * 0.14);
  col = col + vec3f(speckle(px, 2.0, seed + 8.0, 0.988) * 0.10);
  return sat3(col);
}
