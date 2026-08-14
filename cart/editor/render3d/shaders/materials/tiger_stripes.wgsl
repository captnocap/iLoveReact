// @material tiger_stripes
// @slug tiger-stripes
// @name Tiger Stripes
// @board props
// @variant-labels Bengal Blaze, White Tiger, Dusk Ember
// @kind surface
// @tags props, fur, stripes
// @author fable-creature_skins
fn tiger_stripes(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ground = vec3f(0.86, 0.45, 0.10);
  var stripe = vec3f(0.10, 0.06, 0.04);
  var belly = vec3f(0.94, 0.88, 0.78);
  if (variant > 0.5 && variant < 1.5) {
    ground = vec3f(0.88, 0.88, 0.91);
    stripe = vec3f(0.17, 0.18, 0.23);
    belly = vec3f(0.96, 0.95, 0.93);
  } else if (variant >= 1.5) {
    ground = vec3f(0.55, 0.22, 0.08);
    stripe = vec3f(0.07, 0.04, 0.05);
    belly = vec3f(0.80, 0.62, 0.42);
  }
  let sway = snoise(uv.y * 2.2 + seed, uv.x * 1.1 - seed) * 0.16
    + fbm(uv.x * 5.0, uv.y * 5.0 + seed, 3.0) * 0.10;
  let band = sin((uv.x + sway) * 28.0 + seed);
  let taper = fbm(uv.x * 4.0 - seed, uv.y * 9.0 + seed * 0.5, 3.0) * 0.5 + 0.5;
  let mask1 = smoothstep(0.30, 0.62, band) * step(0.32, taper);
  let fur = fbm(uv.x * 32.0 + seed, uv.y * 9.0, 4.0) * 0.5 + 0.5;
  var col = mix(ground * 0.88, ground * 1.10, fur);
  col = mix(col, belly, smoothstep(0.55, 0.97, uv.y) * 0.75);
  col = mix(col, stripe, mask1);
  col = mix(col, stripe * 1.7, mask1 * speckle(px, 2.0, seed, 0.90) * 0.45);
  col = col - vec3f(0.06, 0.05, 0.04) * (1.0 - fur) * 0.6;
  return sat3(col);
}
