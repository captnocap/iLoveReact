// @material frayed_plastic
// @slug frayed-plastic
// @name Frayed Plastic
// @board props
// @variant-labels New Film, Reheated Film, Scraped Film
// @kind surface
// @tags props, plastic, texture
// @author editor
fn frayed_plastic(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.30, 0.70, 0.88);
  var strip = vec3f(0.92, 0.92, 0.96);
  var scratch = vec3f(0.16, 0.18, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.82, 0.56, 0.30);
    strip = vec3f(0.98, 0.86, 0.78);
    scratch = vec3f(0.18, 0.16, 0.15);
  } else if (variant >= 1.5) {
    base = vec3f(0.52, 0.50, 0.53);
    strip = vec3f(0.78, 0.82, 0.84);
    scratch = vec3f(0.10, 0.12, 0.15);
  }
  let edge = 1.0 - smoothstep(0.06, 0.12, abs(uv.x - 0.5));
  var col = mix(base, strip, edge * 0.75);
  let rip = crack_field(uv + vec2f(seed * 0.09, 0.0), seed + 5.0, 8.0);
  col = mix(col, vec3f(0.98, 0.98, 0.98), rip * 0.5);
  let gloss = 1.0 - smoothstep(0.18, 0.35, abs(uv.y - (0.45 + sin(uv.x * 6.0 + seed) * 0.06)));
  col = mix(col, scratch, gloss * 0.24);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 3.4, seed + 8.0, 0.968);
  col = col - vec3f(0.08, 0.08, 0.08) * speckle(px, 1.7, seed + 11.0, 0.98);
  return sat3(col);
}

