// @material refuse
// @slug refuse
// @name Refuse
// @board contraband
// @variant-labels Cardboard, Wet Trash, Crushed Can
// @kind surface
// @tags contraband, refuse
// @author legacy
fn refuse(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Dumpster / street squalor. 0 corrugated cardboard, 1 wet trash w/ wrapper
  // glints, 2 crushed can.
  if (variant < 0.5) {
    let corr = sin(uv.x * 70.0) * 0.5 + 0.5;
    var col = mix(vec3f(0.40, 0.28, 0.16), vec3f(0.66, 0.48, 0.28), fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5);
    col = col * (0.85 + 0.15 * corr);
    let tape = smoothstep(0.44, 0.46, uv.y) * smoothstep(0.58, 0.56, uv.y);
    col = mix(col, vec3f(0.63, 0.58, 0.45), tape * 0.6);
    col = mix(col, vec3f(0.30, 0.22, 0.12), blotch(uv, vec2f(0.7, 0.7), 0.18, vec2f(1.1, 0.9), seed) * 0.5);
    return sat3(col - vec3f(0.08, 0.08, 0.08) * speckle(px, 3.0, seed, 0.92));
  } else if (variant < 1.5) {
    var col = mix(vec3f(0.04, 0.05, 0.04), vec3f(0.12, 0.14, 0.10), fbm(uv.x * 10.0 + seed, uv.y * 10.0, 5.0) * 0.5 + 0.5);
    let glint = speckle(px, 4.0, seed, 0.93);
    let wrap = rand(floor(px / 5.0) + vec2f(seed, seed * 2.0));
    let wcol = vec3f(0.5 + 0.5 * sin(wrap * 30.0), 0.5 + 0.5 * sin(wrap * 30.0 + 2.0), 0.5 + 0.5 * sin(wrap * 30.0 + 4.0));
    col = mix(col, wcol, glint * 0.5);
    col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed + 3.0, 0.96);
    return sat3(col);
  }
  var col = mix(vec3f(0.30, 0.32, 0.34), vec3f(0.62, 0.64, 0.66), fbm(uv.x * 8.0 + seed, uv.y * 14.0, 4.0) * 0.5 + 0.5);
  col = col - vec3f(0.2, 0.2, 0.2) * line_near(snoise(uv.x * 6.0 + seed, uv.y * 4.0 - seed), 0.05);
  let label = smoothstep(0.40, 0.42, uv.y) * smoothstep(0.60, 0.58, uv.y);
  col = mix(col, vec3f(0.85, 0.15, 0.18), label * 0.7);
  return sat3(col + vec3f(0.15, 0.15, 0.15) * line_near(sin(uv.x * 40.0), 0.1));
}
