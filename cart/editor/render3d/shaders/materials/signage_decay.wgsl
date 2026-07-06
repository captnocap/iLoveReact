// @material signage_decay
// @slug signage-decay
// @name Signage Decay
// @board neon_rot
// @variant-labels Faded Letter, Torn Corner, Burned Edge
// @kind surface
// @tags neon_rot, sign, decay, poster
// @author editor
fn signage_decay(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var matte = vec3f(0.09, 0.08, 0.09);
  var ink = vec3f(0.95, 0.90, 0.36);
  var fade = vec3f(0.82, 0.16, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    matte = vec3f(0.10, 0.10, 0.12);
    ink = vec3f(0.74, 0.58, 0.95);
    fade = vec3f(0.20, 0.20, 0.24);
  } else if (variant >= 1.5) {
    matte = vec3f(0.05, 0.05, 0.06);
    ink = vec3f(0.18, 0.90, 0.93);
    fade = vec3f(0.94, 0.44, 0.07);
  }
  let board = rect_mask(uv, 0.08, 0.92, 0.13, 0.87, 0.0012);
  var col = mix(vec3f(0.16, 0.12, 0.11), matte, board);
  let field = fbm(uv.x * 8.0 - seed, uv.y * 5.0 + seed * 0.4, 5.0) * 0.5 + 0.5;
  col = mix(col, ink, smoothstep(0.46, 0.58, field) * board);
  let tear = crack_field(uv + vec2f(seed * 0.03, seed * 0.11), seed + 4.0, 14.0);
  col = mix(col, fade, tear * board);
  col = col + vec3f(0.18, 0.18, 0.18) * speckle(px, 1.8, seed + 9.0, 0.948);
  col = col - vec3f(0.10, 0.10, 0.10) * line_near(uv.y - 0.40, 0.004);
  return sat3(col);
}

