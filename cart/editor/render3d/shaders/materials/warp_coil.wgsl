// @material warp_coil
// @slug warp-coil
// @name Warp Coil
// @board neon_surface
// @variant-labels Nacelle Blue, Tachyon Rose, Dormant Coil
// @kind surface
// @tags neon_surface, coil, warp, rings
// @author fable-scifi_hull
fn warp_coil(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var coil_lo = vec3f(0.12, 0.13, 0.17);
  var coil_hi = vec3f(0.38, 0.41, 0.48);
  var energy = vec3f(0.20, 0.60, 1.00);
  var hot = vec3f(0.80, 0.95, 1.00);
  var power = 1.0;
  if (variant > 0.5 && variant < 1.5) {
    coil_lo = vec3f(0.14, 0.10, 0.14);
    coil_hi = vec3f(0.40, 0.32, 0.42);
    energy = vec3f(0.95, 0.30, 0.65);
    hot = vec3f(1.00, 0.80, 0.90);
  } else if (variant >= 1.5) {
    coil_lo = vec3f(0.10, 0.10, 0.11);
    coil_hi = vec3f(0.30, 0.30, 0.32);
    energy = vec3f(0.25, 0.35, 0.45);
    hot = vec3f(0.50, 0.55, 0.60);
    power = 0.25;
  }
  let ringN = 6.0;
  let yy = uv.y * ringN + seed * 0.17;
  let band = fract(yy);
  let bid = floor(yy);
  let ringw = smoothstep(0.0, 0.30, band) * (1.0 - smoothstep(0.55, 0.85, band));
  let cyl = sin(uv.x * 3.1415926);
  let btone = rand(vec2f(bid, seed));
  var col = mix(vec3f(0.03, 0.03, 0.05), coil_lo, 0.5 + cyl * 0.4);
  let ringcol = mix(coil_lo, coil_hi, cyl * (0.6 + btone * 0.4));
  col = mix(col, ringcol, ringw);
  let gap = smoothstep(0.85, 0.92, band) + (1.0 - smoothstep(0.0, 0.06, band));
  let surge = snoise(uv.x * 4.0 + seed * 2.0, bid * 3.0) * 0.5 + 0.5;
  col = mix(col, energy * (0.5 + surge * 0.8), sat(gap) * power);
  col = col + energy * sat(gap) * surge * power * 0.5;
  let winding = sin(uv.x * 90.0 + bid * 7.0) * 0.5 + 0.5;
  col = col * (1.0 - ringw * 0.18 * winding);
  let edge_hi = exp(-pow(band - 0.30, 2.0) * 250.0);
  col = col + hot * edge_hi * cyl * 0.20 * power;
  let arc = speckle(px, 2.0, seed + bid, 0.99) * sat(gap);
  col = col + hot * arc * power;
  let grime = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 3.0) * 0.5 + 0.5;
  col = col * (0.85 + grime * 0.25);
  return sat3(col);
}
