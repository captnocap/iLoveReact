// @material ramen_bowl
// @slug ramen-bowl
// @name Ramen Bowl
// @board props
// @variant-labels Tonkotsu Rich, Shoyu Dark, Spicy Miso
// @kind composition
// @tags props, ramen, noodles, bowl
// @author fable-food
fn ramen_bowl(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var counter = vec3f(0.34, 0.24, 0.16);
  var bowl = vec3f(0.88, 0.30, 0.22);
  var broth = vec3f(0.90, 0.76, 0.50);
  var noodle = vec3f(0.95, 0.85, 0.52);
  if (variant > 0.5 && variant < 1.5) {
    bowl = vec3f(0.16, 0.18, 0.24);
    broth = vec3f(0.48, 0.30, 0.14);
    noodle = vec3f(0.90, 0.78, 0.44);
  } else if (variant >= 1.5) {
    bowl = vec3f(0.20, 0.20, 0.20);
    broth = vec3f(0.82, 0.42, 0.16);
    noodle = vec3f(0.94, 0.82, 0.48);
  }
  let woodGrain = fbm(uv.x * 3.0 + seed, uv.y * 14.0, 3.0) * 0.5 + 0.5;
  var col = counter * (0.8 + woodGrain * 0.4);
  let ctr = vec2f(0.5, 0.5);
  let d = length(uv - ctr);
  let bowlMask = 1.0 - smoothstep(0.455, 0.475, d);
  let brothMask = 1.0 - smoothstep(0.375, 0.395, d);
  col = mix(col, bowl, bowlMask);
  let rimStripe = smoothstep(0.40, 0.42, d) * (1.0 - smoothstep(0.435, 0.45, d));
  col = mix(col, vec3f(0.96, 0.94, 0.90), rimStripe * bowlMask * 0.8);
  let steam = fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5;
  var soup = broth * (0.85 + steam * 0.3);
  let oilDrop = speckle(px, 4.0, seed + 6.0, 0.955);
  soup = mix(soup, vec3f(0.98, 0.72, 0.28), oilDrop * 0.6);
  let ang = atan2(uv.y - 0.5, uv.x - 0.5);
  let wave = sin(d * 60.0 + ang * 3.0 + seed) * 0.5 + 0.5;
  let noodleMask = smoothstep(0.55, 0.75, wave) * smoothstep(0.34, 0.2, d);
  soup = mix(soup, noodle, noodleMask * 0.9);
  col = mix(col, soup, brothMask);
  let eggWhite = 1.0 - smoothstep(0.075, 0.09, length((uv - vec2f(0.62, 0.40)) * vec2f(1.0, 1.3)));
  let yolk = 1.0 - smoothstep(0.038, 0.05, length((uv - vec2f(0.62, 0.40)) * vec2f(1.0, 1.3)));
  col = mix(col, vec3f(0.97, 0.95, 0.90), eggWhite * brothMask);
  col = mix(col, vec3f(0.96, 0.62, 0.14), yolk * brothMask);
  let scallion = speckle(px, 3.0, seed + 17.0, 0.97) * brothMask * (1.0 - eggWhite);
  col = mix(col, vec3f(0.30, 0.62, 0.24), scallion * 0.9);
  return sat3(col);
}
