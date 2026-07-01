// @material brick_bodega
// @slug brick-bodega
// @name Bodega Front
// @board facades
// @variant-labels Bodega, Laundromat, Diner
// @kind composition
// @tags facades, bodega, front
// @author legacy
fn brick_bodega(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Open corner-store front: barred plate glass, a side entry door, a striped
  // awning, and a neon sign bar above. variant 0 bodega (red), 1 laundromat
  // (blue), 2 diner (yellow/green).
  var col = brick_wall(uv, px, vec3f(0.40, 0.13, 0.085), vec3f(0.74, 0.29, 0.17), vec3f(0.55, 0.53, 0.48), seed);
  var awn = vec3f(0.70, 0.16, 0.16);
  var neon = vec3f(0.98, 0.22, 0.30);
  if (variant > 0.5 && variant < 1.5) { awn = vec3f(0.12, 0.36, 0.66); neon = vec3f(0.30, 0.70, 0.98); }
  else if (variant >= 1.5) { awn = vec3f(0.80, 0.72, 0.18); neon = vec3f(0.24, 0.95, 0.55); }
  // Shop window glass with a warm interior.
  let glass = rect_mask(uv, 0.12, 0.64, 0.08, 0.60, 0.006);
  let refl = smoothstep(0.0, 1.0, (uv.y - 0.08) / 0.52);
  var pane = mix(vec3f(0.06, 0.09, 0.12), vec3f(0.14, 0.20, 0.25), refl);
  pane = mix(pane, vec3f(0.85, 0.70, 0.38), (1.0 - refl) * 0.40);
  col = mix(col, pane, glass);
  // Security bars over the glass.
  let bars = (1.0 - smoothstep(0.004, 0.009, abs(fract(uv.x * 18.0) - 0.5))) * glass;
  col = mix(col, vec3f(0.10, 0.10, 0.11), bars * 0.8);
  // Side entry door with its own glass light.
  let door = rect_mask(uv, 0.68, 0.88, 0.0, 0.62, 0.006);
  col = mix(col, vec3f(0.16, 0.15, 0.16), door);
  let doorglass = rect_mask(uv, 0.70, 0.86, 0.30, 0.58, 0.006);
  col = mix(col, mix(vec3f(0.10, 0.13, 0.16), vec3f(0.80, 0.66, 0.36), 0.4), doorglass);
  // Striped awning across the storefront.
  let aw = rect_mask(uv, 0.08, 0.92, 0.64, 0.78, 0.006);
  let stripe = step(0.5, fract(uv.x * 12.0));
  col = mix(col, mix(awn, vec3f(0.92, 0.90, 0.85), stripe * 0.8), aw);
  // Dark sign board + a buzzing neon bar (stand-in for the shop name).
  let signbg = rect_mask(uv, 0.28, 0.72, 0.80, 0.92, 0.006);
  col = mix(col, vec3f(0.05, 0.05, 0.06), signbg);
  let buzz = 0.8 + 0.2 * sin(U.time * 30.0 + seed);
  let neonline = (1.0 - smoothstep(0.006, 0.014, abs(uv.y - 0.86))) * step(0.32, uv.x) * step(uv.x, 0.68);
  col = col + neon * neonline * buzz;
  col = col + neon * signbg * exp(-abs(uv.y - 0.86) * 26.0) * 0.18;
  return sat3(col);
}
