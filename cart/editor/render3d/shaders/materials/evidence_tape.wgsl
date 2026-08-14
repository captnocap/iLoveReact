// @material evidence_tape
// @slug evidence
// @name Evidence
// @board contraband
// @variant-labels Hazard Tape, Chalk Outline, Numbered Marker
// @kind surface
// @tags contraband, evidence
// @author legacy
fn evidence_tape(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // The investigation made physical. 0 hazard tape, 1 chalk outline on asphalt,
  // 2 numbered evidence marker (folded tent).
  if (variant < 0.5) {
    var col = mix(vec3f(0.05, 0.05, 0.06), vec3f(0.09, 0.09, 0.10), fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5);
    let band = smoothstep(0.38, 0.40, uv.y) * smoothstep(0.62, 0.60, uv.y);
    let stripe = step(0.5, fract((uv.x - uv.y) * 9.0));
    col = mix(col, mix(vec3f(0.96, 0.82, 0.05), vec3f(0.04, 0.04, 0.04), stripe), band);
    return sat3(col);
  } else if (variant < 1.5) {
    var col = mix(vec3f(0.06, 0.06, 0.07), vec3f(0.11, 0.11, 0.12), fbm(uv.x * 18.0 + seed, uv.y * 18.0, 5.0) * 0.5 + 0.5);
    let head = line_near(length((uv - vec2f(0.5, 0.28)) * vec2f(1.0, 1.0)) - 0.10, 0.012);
    let body = line_near(length((uv - vec2f(0.5, 0.62)) * vec2f(0.7, 1.4)) - 0.22, 0.012);
    let chalk = sat(head + body) * (0.6 + 0.4 * speckle(px, 2.0, seed, 0.4));
    col = mix(col, vec3f(0.86, 0.88, 0.84), chalk);
    return sat3(col);
  }
  var col = mix(vec3f(0.07, 0.07, 0.08), vec3f(0.12, 0.12, 0.13), fbm(uv.x * 16.0 + seed, uv.y * 16.0, 4.0) * 0.5 + 0.5);
  let tent = (1.0 - smoothstep(0.0, 0.02, abs(uv.x - 0.5) - (uv.y - 0.30) * 0.6)) * smoothstep(0.30, 0.32, uv.y) * smoothstep(0.82, 0.80, uv.y);
  col = mix(col, vec3f(0.96, 0.80, 0.06), tent);
  let num = (1.0 - smoothstep(0.0, 0.015, abs(uv.x - 0.5) - 0.04)) * smoothstep(0.55, 0.57, uv.y) * smoothstep(0.72, 0.70, uv.y);
  col = mix(col, vec3f(0.1, 0.05, 0.0), num);
  return sat3(col);
}
