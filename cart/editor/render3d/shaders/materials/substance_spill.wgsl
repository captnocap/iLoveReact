// @material substance_spill
// @slug substance
// @name Substance
// @board contraband
// @variant-labels Pills, Lines + Razor, Residue
// @kind surface
// @tags contraband, substance
// @author legacy
fn substance_spill(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // The high system's substance, the most-Spun prop. 0 scattered pills,
  // 1 chopped lines on a mirror + razor, 2 residue smear.
  if (variant < 0.5) {
    var col = mix(vec3f(0.10, 0.10, 0.12), vec3f(0.16, 0.16, 0.18), fbm(uv.x * 12.0 + seed, uv.y * 12.0, 4.0) * 0.5 + 0.5);
    for (var i = 0; i < 7; i = i + 1) {
      let fi = f32(i);
      let c = vec2f(rand(vec2f(fi, seed)), rand(vec2f(fi + 9.0, seed)));
      let pill = 1.0 - smoothstep(0.04, 0.05, length((uv - c) * vec2f(1.0, 1.8)));
      let cap_half = step(uv.x, c.x);
      let pc = mix(vec3f(0.9, 0.2, 0.2), vec3f(0.95, 0.95, 0.98), cap_half);
      col = mix(col, pc, pill);
      col = col + vec3f(0.4, 0.4, 0.4) * (1.0 - smoothstep(0.0, 0.02, length((uv - c + vec2f(0.0, 0.01)) * vec2f(1.0, 1.8)))) * pill;
    }
    return sat3(col);
  } else if (variant < 1.5) {
    var col = mix(vec3f(0.06, 0.07, 0.10), vec3f(0.14, 0.16, 0.22), uv.y);
    col = col + vec3f(0.10, 0.10, 0.10) * line_near(uv.x - 0.5, 0.3);
    let l1 = segment_mark(uv, vec2f(0.20, 0.40), vec2f(0.62, 0.40), 0.018);
    let l2 = segment_mark(uv, vec2f(0.24, 0.55), vec2f(0.70, 0.55), 0.016);
    let l3 = segment_mark(uv, vec2f(0.30, 0.70), vec2f(0.66, 0.70), 0.014);
    let lines = sat(l1 + l2 + l3);
    col = mix(col, vec3f(0.96, 0.97, 0.99), lines * (0.7 + 0.3 * speckle(px, 1.4, seed, 0.4)));
    let blade = step(0.72, uv.x) * step(uv.x, 0.90) * step(0.30, uv.y) * step(uv.y, 0.78);
    col = mix(col, vec3f(0.75, 0.78, 0.82), blade * 0.8);
    return sat3(col);
  }
  var col = mix(vec3f(0.08, 0.08, 0.10), vec3f(0.14, 0.14, 0.16), fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5);
  let smear = blotch(uv, vec2f(0.5, 0.5), 0.28, vec2f(1.6, 0.6), seed) * (fbm(uv.x * 8.0 + seed, uv.y * 4.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.80, 0.80, 0.84), smear * 0.6);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 1.6, seed, 0.7);
  return sat3(col);
}
