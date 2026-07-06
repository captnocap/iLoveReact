// @material autumn_leaves
// @slug autumn-leaves
// @name Autumn Leaves
// @board environment
// @variant-labels Fresh Fall, Rain Matted, Late Brown
// @kind surface
// @tags environment, leaves, autumn
// @author fable-botanic
fn autumn_leaves(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var red_c = vec3f(0.68, 0.16, 0.08);
  var orange_c = vec3f(0.82, 0.44, 0.10);
  var gold_c = vec3f(0.86, 0.66, 0.20);
  var brown_c = vec3f(0.42, 0.26, 0.12);
  var wetdark = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    red_c = vec3f(0.40, 0.10, 0.06);
    orange_c = vec3f(0.48, 0.26, 0.08);
    gold_c = vec3f(0.50, 0.38, 0.14);
    brown_c = vec3f(0.22, 0.14, 0.08);
    wetdark = 1.0;
  } else if (variant >= 1.5) {
    red_c = vec3f(0.45, 0.25, 0.12);
    orange_c = vec3f(0.52, 0.34, 0.16);
    gold_c = vec3f(0.58, 0.44, 0.22);
    brown_c = vec3f(0.34, 0.24, 0.13);
  }
  let v = voronoi(uv.x * 12.0 + seed * 0.5, uv.y * 12.0 + seed * 0.2);
  let h = fract(v.y * 9.17);
  var leaf = red_c;
  if (h > 0.25 && h < 0.5) { leaf = orange_c; }
  else if (h >= 0.5 && h < 0.75) { leaf = gold_c; }
  else if (h >= 0.75) { leaf = brown_c; }
  let border = smoothstep(0.30, 0.62, v.x);
  var col = mix(leaf, vec3f(0.10, 0.07, 0.04), border);
  let vein = line_near(sin((uv.x + uv.y * 0.7) * 70.0 + v.y * 9.0), 0.12);
  col = mix(col, leaf * 0.65, vein * (1.0 - border) * 0.6);
  let curl = fbm(uv.x * 20.0 + seed, uv.y * 20.0, 4.0) * 0.5 + 0.5;
  col = col * (0.80 + curl * 0.35);
  let rot = speckle(px, 3.0, seed + 2.0, 0.94);
  col = mix(col, vec3f(0.14, 0.10, 0.06), rot * 0.6);
  let gloss = pow(sat(snoise(uv.x * 14.0 + seed, uv.y * 14.0) * 0.5 + 0.5), 5.0);
  col = col + vec3f(0.20, 0.20, 0.22) * gloss * wetdark;
  return sat3(col);
}
