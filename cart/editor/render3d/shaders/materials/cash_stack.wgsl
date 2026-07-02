// @material cash_stack
// @slug cash-stack
// @name Cash Stack
// @board contraband
// @variant-labels Clean, Worn, Blood
// @kind surface
// @tags contraband, cash, stack
// @author legacy
fn cash_stack(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Banded stack of bills with a face (portrait + guilloche). The money asset.
  // 0 clean, 1 worn/dirty, 2 blood-spattered.
  let bills = 14.0;
  let edge = line_near(fract(uv.y * bills) - 0.5, 0.10);
  let paper = mix(vec3f(0.30, 0.42, 0.30), vec3f(0.52, 0.66, 0.50), fbm(uv.x * 10.0 + seed, uv.y * 40.0, 4.0) * 0.5 + 0.5);
  let face_zone = smoothstep(0.30, 0.45, uv.y);
  let guilloche = line_near(sin(uv.x * 60.0) * sin(uv.y * 55.0 + seed), 0.20);
  let portrait = 1.0 - smoothstep(0.10, 0.13, length((uv - vec2f(0.5, 0.72)) * vec2f(1.4, 1.0)));
  var face = mix(vec3f(0.20, 0.36, 0.24), vec3f(0.42, 0.60, 0.42), guilloche * 0.5 + 0.4);
  face = mix(face, vec3f(0.55, 0.68, 0.54), portrait * 0.5);
  var col = mix(paper, face, face_zone);
  col = col - vec3f(0.10, 0.10, 0.10) * edge;
  if (variant > 0.5 && variant < 1.5) {
    col = col * 0.7 + vec3f(0.05, 0.04, 0.0) * (fbm(uv.x * 8.0, uv.y * 8.0 + seed, 4.0) * 0.5 + 0.5);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.40, 0.02, 0.02), blotch(uv, vec2f(0.62, 0.40), 0.18, vec2f(1.0, 1.2), seed) * 0.7);
  }
  return sat3(col - vec3f(speckle(px, 3.0, seed, 0.95) * 0.05));
}
