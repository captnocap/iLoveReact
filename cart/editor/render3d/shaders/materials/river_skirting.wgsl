// @material river_skirting
// @slug river-skirting
// @name River Skirting
// @board wood_brick_stone
// @variant-labels Mud Silt, Pebble Skin, Dry Vein
// @kind surface
// @tags wood_brick_stone, stone, river, skirting
// @author editor
fn river_skirting(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.60, 0.59, 0.57);
  var vein = vec3f(0.29, 0.27, 0.26);
  var edge = vec3f(0.82, 0.77, 0.70);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.55, 0.53, 0.52);
    vein = vec3f(0.38, 0.38, 0.38);
    edge = vec3f(0.95, 0.91, 0.87);
  } else if (variant >= 1.5) {
    base = vec3f(0.72, 0.72, 0.72);
    vein = vec3f(0.45, 0.42, 0.39);
    edge = vec3f(0.48, 0.44, 0.39);
  }
  let n = fbm(uv.x * 5.5 + seed, uv.y * 5.5 - seed, 4.0) * 0.5 + 0.5;
  let bands = 1.0 - smoothstep(0.02, 0.08, abs(sin((uv.x + uv.y * 3.0) * 14.0 + seed) - n));
  var col = mix(base, edge, smoothstep(0.30, 0.75, n));
  col = mix(col, vein, bands);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.0, seed + 8.0, 0.972);
  col = col - vec3f(0.05, 0.04, 0.04) * crack_field(uv, seed + 4.0, 16.0);
  return sat3(col);
}

