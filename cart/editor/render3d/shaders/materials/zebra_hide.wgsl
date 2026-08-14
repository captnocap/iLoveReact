// @material zebra_hide
// @slug zebra-hide
// @name Zebra Hide
// @board props
// @variant-labels Plains Classic, Foal Brown, Vice Zebra
// @kind surface
// @tags props, hide, stripes
// @author fable-creature_skins
fn zebra_hide(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lightc = vec3f(0.93, 0.92, 0.88);
  var darkc = vec3f(0.10, 0.09, 0.09);
  var freq = 20.0;
  var wob = 0.55;
  if (variant > 0.5 && variant < 1.5) {
    lightc = vec3f(0.88, 0.82, 0.70);
    darkc = vec3f(0.31, 0.20, 0.13);
    freq = 26.0;
  } else if (variant >= 1.5) {
    lightc = vec3f(0.85, 0.92, 0.95);
    darkc = vec3f(0.15, 0.05, 0.21);
    freq = 15.0;
    wob = 0.9;
  }
  let flow = fbm(uv.x * 2.4 + seed, uv.y * 2.4 - seed, 4.0);
  let flow2 = snoise(uv.x * 4.0 - seed, uv.y * 3.0 + seed * 0.6);
  let d = uv.x * 0.9 + uv.y * 0.45 + flow * wob + flow2 * 0.12;
  let mask1 = smoothstep(-0.18, 0.18, sin(d * freq));
  var col = mix(darkc, lightc, mask1);
  let grain = fbm(uv.x * 42.0 + seed, uv.y * 8.0, 3.0) * 0.5 + 0.5;
  col = col * (0.90 + grain * 0.20);
  let muscle = fbm(uv.x * 1.5, uv.y * 1.5 + seed, 3.0) * 0.5 + 0.5;
  col = col - vec3f(0.09, 0.08, 0.07) * muscle * 0.5;
  col = mix(col, lightc * 1.05, speckle(px, 2.0, seed + 9.0, 0.96) * mask1 * 0.5);
  return sat3(col);
}
