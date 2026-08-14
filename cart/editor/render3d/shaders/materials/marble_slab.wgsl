// @material marble_slab
// @slug marble-slab
// @name Marble Slab
// @board wood_brick_stone
// @variant-labels White Vein, Green Vein, Black Vein
// @kind surface
// @tags wood_brick_stone, marble, slab
// @author legacy
fn marble_slab(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.86, 0.84, 0.78);
  var vein = vec3f(0.28, 0.28, 0.30);
  if (variant > 0.5 && variant < 1.5) { base = vec3f(0.20, 0.42, 0.34); vein = vec3f(0.76, 0.82, 0.70); }
  else if (variant >= 1.5) { base = vec3f(0.06, 0.06, 0.07); vein = vec3f(0.72, 0.68, 0.60); }
  let warp = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 5.0);
  let v = line_near(sin((uv.x + uv.y * 0.55 + warp * 0.15) * 22.0), 0.040);
  var col = mix(base * 0.85, base * 1.18, fbm(uv.x * 10.0, uv.y * 10.0 + seed, 4.0) * 0.5 + 0.5);
  col = mix(col, vein, v * 0.55);
  let seam = max(line_near(uv.x - 0.5, 0.004), line_near(uv.y - 0.5, 0.004));
  col = mix(col, vec3f(0.02, 0.02, 0.02), seam * 0.35);
  return sat3(col);
}
