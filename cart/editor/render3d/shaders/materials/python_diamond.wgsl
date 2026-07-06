// @material python_diamond
// @slug python-diamond
// @name Python Diamond
// @board props
// @variant-labels Burmese Tan, Ghost Grey, Sunset Morph
// @kind surface
// @tags props, scales, snake
// @author fable-creature_skins
fn python_diamond(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var basec = vec3f(0.72, 0.56, 0.32);
  var diac = vec3f(0.21, 0.13, 0.07);
  var corec = vec3f(0.86, 0.72, 0.45);
  if (variant > 0.5 && variant < 1.5) {
    basec = vec3f(0.74, 0.73, 0.70);
    diac = vec3f(0.32, 0.31, 0.32);
    corec = vec3f(0.90, 0.89, 0.85);
  } else if (variant >= 1.5) {
    basec = vec3f(0.88, 0.58, 0.26);
    diac = vec3f(0.45, 0.16, 0.20);
    corec = vec3f(0.96, 0.82, 0.52);
  }
  let w = snoise(uv.x * 3.0 + seed, uv.y * 3.0 - seed) * 0.09;
  let a = (uv.x + uv.y) * 6.0 + w + seed * 0.07;
  let b = (uv.x - uv.y) * 6.0 - w + seed * 0.05;
  let dia = abs(fract(a) - 0.5) + abs(fract(b) - 0.5);
  let dm = 1.0 - smoothstep(0.30, 0.44, dia);
  let corem = 1.0 - smoothstep(0.08, 0.18, dia);
  let gp = uv * 60.0;
  let bead = 1.0 - smoothstep(0.28, 0.45, length(fract(gp + seed) - 0.5));
  var col = mix(basec * 0.92, basec * 1.08, fbm(uv.x * 8.0 + seed, uv.y * 8.0, 3.0) * 0.5 + 0.5);
  col = mix(col, diac, dm * 0.9);
  col = mix(col, corec, corem * 0.85);
  col = col - vec3f(0.07, 0.06, 0.04) * bead * 0.5;
  col = mix(col, corec * 1.05, smoothstep(0.75, 1.0, uv.y) * 0.35);
  col = col - vec3f(0.10, 0.08, 0.05) * speckle(px, 3.0, seed + 2.0, 0.95);
  return sat3(col);
}
