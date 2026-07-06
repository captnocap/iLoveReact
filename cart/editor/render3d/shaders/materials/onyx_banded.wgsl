// @material onyx_banded
// @slug onyx-banded
// @name Banded Onyx
// @board wood_brick_stone
// @variant-labels Amber Glow, Honey Milk, Jade Onyx
// @kind surface
// @tags wood_brick_stone, onyx, banded, translucent
// @author fable-geology
fn onyx_banded(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.42, 0.20, 0.06);
  var mid = vec3f(0.78, 0.48, 0.16);
  var glow = vec3f(0.96, 0.78, 0.42);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.60, 0.42, 0.20);
    mid = vec3f(0.86, 0.70, 0.44);
    glow = vec3f(0.97, 0.92, 0.78);
  } else if (variant >= 1.5) {
    deep = vec3f(0.08, 0.26, 0.18);
    mid = vec3f(0.24, 0.52, 0.36);
    glow = vec3f(0.66, 0.88, 0.66);
  }
  let warp = fbm(uv.x * 2.4 + seed * 0.5, uv.y * 2.4 - seed * 0.3, 3.0);
  let bv = (uv.y + warp * 0.5) * 9.0 + seed * 0.27;
  let band_id = floor(bv);
  let bt = rand(vec2f(band_id, floor(seed * 0.4)));
  var col = mix(deep, mid, bt);
  let f = fract(bv);
  col = mix(col, glow, pow(sat(1.0 - abs(f - 0.5) * 2.0), 2.5) * (0.35 + bt * 0.55));
  let wisp = fbm(uv.x * 8.0 - seed * 0.6, (uv.y + warp * 0.5) * 20.0, 3.0);
  col = mix(col, glow, smoothstep(0.25, 0.45, wisp) * 0.3);
  col = mix(col, deep * 0.8, smoothstep(0.06, 0.0, f) * 0.6);
  col = col + glow * pow(sat(1.0 - length(uv - vec2f(0.4 + fract(seed * 0.02) * 0.3, 0.45)) * 1.6), 2.0) * 0.22;
  col = col + vec3f(0.95, 0.90, 0.75) * speckle(px, 2.0, seed + 4.0, 0.992) * 0.6;
  return sat3(col);
}
