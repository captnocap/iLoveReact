// @material cobalt_frost
// @slug cobalt-frost
// @name Cobalt Frost
// @board gradients
// @variant-labels Icy Fade, Cyan Fade, Violet Fade
// @kind surface
// @tags gradients, cobalt, frost, bloom
// @author editor
fn cobalt_frost(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var pale = vec3f(0.82, 0.88, 0.94);
  var cool = vec3f(0.35, 0.60, 0.96);
  var glow = vec3f(0.92, 0.24, 0.78);
  if (variant > 0.5 && variant < 1.5) {
    pale = vec3f(0.92, 0.96, 1.00);
    cool = vec3f(0.20, 0.46, 0.88);
    glow = vec3f(0.54, 0.74, 0.94);
  } else if (variant >= 1.5) {
    pale = vec3f(0.88, 0.70, 0.95);
    cool = vec3f(0.55, 0.31, 0.88);
    glow = vec3f(0.96, 0.45, 0.70);
  }
  let cloud = fbm(uv.x * 2.4 + seed, uv.y * 2.9, 4.0) * 0.5 + 0.5;
  let frost = 1.0 - smoothstep(0.10, 0.15, abs(sin(uv.x * 40.0 + seed + uv.y * 8.0)));
  var col = mix(pale, cool, sat(cloud + 0.15));
  col = mix(col, glow, frost * (0.35 + cloud * 0.2));
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 1.9, seed + 5.0, 0.972);
  col = col - vec3f(0.05, 0.05, 0.05) * speckle(px, 2.9, seed + 11.0, 0.934);
  return sat3(col);
}
