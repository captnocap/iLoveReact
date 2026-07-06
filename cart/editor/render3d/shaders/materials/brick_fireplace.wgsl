// @material brick_fireplace
// @slug brick-fireplace
// @name Brick Fireplace
// @board liminal
// @variant-labels Painted White, Red Colonial, Soot Choked
// @kind composition
// @tags liminal, fireplace, brick, soot
// @author fable-interior_home
fn brick_fireplace(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.82, 0.80, 0.76);
  var hi = vec3f(0.92, 0.90, 0.86);
  var mortar_tone = vec3f(0.70, 0.68, 0.64);
  var soot_amt = 0.6;
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.44, 0.16, 0.10);
    hi = vec3f(0.72, 0.30, 0.16);
    mortar_tone = vec3f(0.62, 0.58, 0.52);
    soot_amt = 0.75;
  } else if (variant >= 1.5) {
    lo = vec3f(0.35, 0.22, 0.16);
    hi = vec3f(0.55, 0.36, 0.24);
    mortar_tone = vec3f(0.40, 0.36, 0.32);
    soot_amt = 1.0;
  }
  var col = brick_wall(uv, px, lo, hi, mortar_tone, seed);
  let mouth_x = 1.0 - smoothstep(0.20, 0.24, abs(uv.x - 0.5));
  let mouth_y = smoothstep(0.46, 0.50, uv.y);
  let arch = smoothstep(0.42, 0.50, uv.y + abs(uv.x - 0.5) * 0.35);
  let mouth = mouth_x * mouth_y * arch;
  let flicker = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.05, 0.04, 0.04) + vec3f(0.22, 0.08, 0.02) * flicker * (1.0 - soot_amt * 0.5), mouth);
  let plume = (1.0 - smoothstep(0.10, 0.34, abs(uv.x - 0.5))) * smoothstep(0.55, 0.05, uv.y);
  let wisp = fbm(uv.x * 9.0, uv.y * 5.0 + seed * 0.3, 3.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.10, 0.09, 0.09), plume * wisp * soot_amt * 0.8);
  let lintel = line_near(uv.y - 0.46, 0.02) * mouth_x;
  col = mix(col, vec3f(0.28, 0.26, 0.24), lintel * 0.8);
  col = mix(col, vec3f(0.12, 0.11, 0.10), speckle(px, 3.0, seed + 5.0, 0.97) * 0.5);
  return sat3(col);
}
