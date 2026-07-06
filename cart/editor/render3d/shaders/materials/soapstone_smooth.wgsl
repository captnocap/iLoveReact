// @material soapstone_smooth
// @slug soapstone-smooth
// @name Smooth Soapstone
// @board wood_brick_stone
// @variant-labels Sage Grey, Storm Slab, Charcoal Milk
// @kind surface
// @tags wood_brick_stone, soapstone, talc, smooth
// @author fable-geology
fn soapstone_smooth(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.42, 0.48, 0.44);
  var cloud = vec3f(0.32, 0.38, 0.35);
  var talc = vec3f(0.78, 0.80, 0.74);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.40, 0.42, 0.45);
    cloud = vec3f(0.30, 0.32, 0.36);
    talc = vec3f(0.72, 0.74, 0.76);
  } else if (variant >= 1.5) {
    base = vec3f(0.20, 0.21, 0.22);
    cloud = vec3f(0.13, 0.14, 0.15);
    talc = vec3f(0.82, 0.82, 0.78);
  }
  let drift = fbm(uv.x * 4.0 + seed * 0.6, uv.y * 4.0 - seed * 0.4, 3.0);
  var col = mix(cloud, base, 0.5 + drift * 0.9);
  let swirl = fbm(uv.x * 9.0 - seed * 0.3, uv.y * 9.0 + seed * 0.7, 3.0);
  col = mix(col, cloud, smoothstep(0.1, 0.4, swirl) * 0.4);
  let vein_n = snoise(uv.x * 5.0 + seed * 0.9, uv.y * 5.0 - seed * 0.5);
  let vein = smoothstep(0.90, 0.99, 1.0 - abs(vein_n));
  col = mix(col, talc, vein * 0.7);
  col = mix(col, talc * 0.9, crack_field(uv, seed + 5.0, 2.0) * 0.45);
  let grain = fbm(uv.x * 30.0 + seed, uv.y * 30.0, 3.0);
  col = col * (0.95 + grain * 0.14);
  let sheen = pow(sat(1.0 - abs(uv.y - 0.35 - fract(seed * 0.03) * 0.3) * 2.0), 3.0);
  col = col + vec3f(0.06, 0.07, 0.06) * sheen;
  return sat3(col);
}
