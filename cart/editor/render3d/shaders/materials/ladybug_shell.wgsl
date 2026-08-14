// @material ladybug_shell
// @slug ladybug-shell
// @name Ladybug Shell
// @board props
// @variant-labels Garden Red, Citrus Yellow, Twice Stabbed
// @kind composition
// @tags props, beetle, shell
// @author fable-creature_skins
fn ladybug_shell(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var shellc = vec3f(0.82, 0.14, 0.08);
  var dotc = vec3f(0.08, 0.06, 0.07);
  var headc = vec3f(0.10, 0.08, 0.09);
  if (variant > 0.5 && variant < 1.5) {
    shellc = vec3f(0.92, 0.72, 0.14);
    dotc = vec3f(0.12, 0.09, 0.08);
  } else if (variant >= 1.5) {
    shellc = vec3f(0.13, 0.10, 0.11);
    dotc = vec3f(0.85, 0.20, 0.10);
    headc = vec3f(0.08, 0.07, 0.08);
  }
  let j = fract(seed * 0.013) * 0.05;
  let xm = vec2f(abs(uv.x - 0.5), uv.y);
  var dots = dot_mark(xm, vec2f(0.20 + j, 0.36), 0.075);
  dots = max(dots, dot_mark(xm, vec2f(0.34 - j, 0.55), 0.065));
  dots = max(dots, dot_mark(xm, vec2f(0.12, 0.62 + j), 0.055));
  dots = max(dots, dot_mark(xm, vec2f(0.26 + j, 0.80), 0.06));
  let sheen = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  var col = shellc * (0.88 + sheen * 0.20);
  let domeShade = length((uv - vec2f(0.5, 0.5)) * vec2f(1.4, 1.2));
  col = col - vec3f(0.20, 0.10, 0.08) * smoothstep(0.35, 0.75, domeShade);
  col = mix(col, dotc, dots);
  let seam = line_near(uv.x - 0.5, 0.012) * smoothstep(0.14, 0.22, uv.y);
  col = mix(col, headc, seam * 0.9);
  let pron = 1.0 - smoothstep(0.14, 0.19, uv.y);
  col = mix(col, headc, pron);
  col = mix(col, vec3f(0.92, 0.90, 0.88), dot_mark(xm, vec2f(0.30, 0.07), 0.05) * pron);
  let gloss = 1.0 - smoothstep(0.0, 0.30, length(uv - vec2f(0.34, 0.32)));
  col = col + vec3f(0.30, 0.26, 0.24) * gloss * 0.5;
  return sat3(col);
}
