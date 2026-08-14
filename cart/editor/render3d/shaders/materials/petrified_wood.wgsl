// @material petrified_wood
// @slug petrified-wood
// @name Petrified Wood
// @board wood_brick_stone
// @variant-labels Amber Agate, Red Jasper, Smoke Opal
// @kind surface
// @tags wood_brick_stone, petrified, agate, rings
// @author fable-geology
fn petrified_wood(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ring_a = vec3f(0.72, 0.48, 0.22);
  var ring_b = vec3f(0.42, 0.22, 0.12);
  var vein = vec3f(0.88, 0.78, 0.58);
  if (variant > 0.5 && variant < 1.5) {
    ring_a = vec3f(0.64, 0.24, 0.14);
    ring_b = vec3f(0.34, 0.10, 0.08);
    vein = vec3f(0.86, 0.62, 0.40);
  } else if (variant >= 1.5) {
    ring_a = vec3f(0.48, 0.46, 0.48);
    ring_b = vec3f(0.24, 0.22, 0.26);
    vein = vec3f(0.78, 0.74, 0.68);
  }
  let ctr = vec2f(0.5 + (rand(vec2f(seed, 1.0)) - 0.5) * 0.5, 0.5 + (rand(vec2f(seed, 2.0)) - 0.5) * 0.5);
  let q = (uv - ctr) * vec2f(1.0, 1.4);
  let rr = length(q) + fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.06;
  let ring = sin(rr * 64.0 + seed);
  var col = mix(ring_b, ring_a, smoothstep(-0.8, 0.8, ring));
  let ring2 = sin(rr * 64.0 * 2.7 + seed * 1.3);
  col = mix(col, ring_b * 0.7, smoothstep(0.5, 0.95, ring2) * 0.4);
  let ray = crack_field(uv - ctr + vec2f(0.5, 0.5), seed + 4.0, 2.0);
  col = mix(col, vein, ray * 0.75);
  let knot = smoothstep(0.05, 0.01, rr);
  col = mix(col, ring_b * 0.55, knot);
  col = col + vec3f(0.92, 0.88, 0.80) * speckle(px, 2.0, seed + 6.0, 0.985) * 0.6;
  let sheen = pow(sat(1.0 - abs(uv.x + uv.y - 1.05) * 2.0), 3.0);
  col = col + vec3f(0.10, 0.08, 0.06) * sheen;
  return sat3(col);
}
