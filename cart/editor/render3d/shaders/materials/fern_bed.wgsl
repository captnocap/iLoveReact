// @material fern_bed
// @slug fern-bed
// @name Fern Bed
// @board environment
// @variant-labels Shade Grove, Sunlit Fronds, Bronze Dieback
// @kind surface
// @tags environment, fern, undergrowth
// @author fable-botanic
fn fern_bed(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.02, 0.08, 0.04);
  var frond_lo = vec3f(0.08, 0.26, 0.10);
  var frond_hi = vec3f(0.24, 0.52, 0.18);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.05, 0.12, 0.05);
    frond_lo = vec3f(0.16, 0.36, 0.12);
    frond_hi = vec3f(0.48, 0.68, 0.26);
  } else if (variant >= 1.5) {
    deep = vec3f(0.07, 0.05, 0.03);
    frond_lo = vec3f(0.30, 0.22, 0.10);
    frond_hi = vec3f(0.55, 0.40, 0.16);
  }
  var col = deep;
  let mottle = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5;
  col = mix(col, frond_lo * 0.6, mottle * 0.5);
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let p = uv * (4.0 + fi * 1.5) + vec2f(seed * 0.31 + fi * 3.7, seed * 0.17 + fi * 1.9);
    let row = floor(p.y);
    let bend = sin(p.x * 2.0 + row * 1.7 + seed) * 0.16;
    let fy = fract(p.y) - 0.5 + bend;
    let spine = line_near(fy * 2.4, 0.09);
    let leaflet = line_near(sin((p.x + abs(fy) * 3.5) * 24.0), 0.32) * smoothstep(0.42, 0.08, abs(fy));
    let tone = mix(frond_lo, frond_hi, fract(row * 0.618 + fi * 0.27));
    let layer_amt = 0.45 + fi * 0.25;
    col = mix(col, tone, sat(spine + leaflet * 0.85) * layer_amt);
  }
  let dew = speckle(px, 2.0, seed + 4.0, 0.975);
  col = col + vec3f(0.14, 0.16, 0.12) * dew;
  let shade = fbm(uv.x * 2.5 + seed * 2.1, uv.y * 2.5, 3.0) * 0.5 + 0.5;
  col = col * (0.78 + shade * 0.38);
  return sat3(col);
}
