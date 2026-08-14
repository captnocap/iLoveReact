// @material brick_shopfront
// @slug brick-shopfront
// @name Brick Shopfront
// @board facades
// @variant-labels Green Awning, Red Awning, Blue Awning
// @kind composition
// @tags facades, brick, shopfront
// @author legacy
fn brick_shopfront(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Mixed-use ground floor: brick piers either side, a striped awning across the
  // top, a sign band, and a big plate-glass shop window over a bulkhead. Apply to
  // the bottom row of faces; brick_facade above it. variant 0 green, 1 red, 2 blue.
  var col = brick_wall(uv, px, vec3f(0.40, 0.13, 0.085), vec3f(0.74, 0.29, 0.17), vec3f(0.55, 0.53, 0.48), seed);
  var awn = vec3f(0.10, 0.42, 0.22);
  if (variant > 0.5 && variant < 1.5) {
    awn = vec3f(0.62, 0.12, 0.12);
  } else if (variant >= 1.5) {
    awn = vec3f(0.10, 0.22, 0.50);
  }
  // Storefront opening: central bay, brick piers on the outer 14%.
  let px0 = 0.14; let px1 = 0.86;
  // Plate glass between the bulkhead (bottom) and the sign band (top).
  let gy0 = 0.10; let gy1 = 0.66;
  let glass = rect_mask(uv, px0 + 0.03, px1 - 0.03, gy0, gy1, 0.008);
  let refl = smoothstep(0.0, 1.0, (uv.y - gy0) / (gy1 - gy0));
  var pane = mix(vec3f(0.07, 0.10, 0.13), vec3f(0.16, 0.22, 0.27), refl);
  // Warm interior glow low in the window, diagonal highlight streak across it.
  pane = mix(pane, vec3f(0.85, 0.66, 0.34), (1.0 - refl) * 0.45);
  pane = pane + vec3f(0.18, 0.18, 0.16) * (1.0 - smoothstep(0.02, 0.06, abs((uv.x - 0.5) + (uv.y - 0.4) * 0.6)));
  let frame = vec3f(0.14, 0.13, 0.12);
  let frame_mask = rect_mask(uv, px0, px1, gy0 - 0.02, gy1 + 0.02, 0.006) * (1.0 - rect_mask(uv, px0 + 0.03, px1 - 0.03, gy0, gy1, 0.006));
  // Bulkhead panel below the glass.
  let bulk = rect_mask(uv, px0, px1, 0.0, gy0, 0.006);
  col = mix(col, vec3f(0.16, 0.15, 0.14), bulk);
  col = mix(col, pane, glass);
  col = mix(col, frame, frame_mask);
  // Sign band across the top of the opening.
  let sign = rect_mask(uv, px0, px1, 0.78, 0.90, 0.006);
  col = mix(col, vec3f(0.10, 0.10, 0.11), sign);
  // Striped awning slung above the sign band, scalloped lower edge.
  let aw_y0 = 0.66; let aw_y1 = 0.80;
  let scallop = 0.012 * (sin(uv.x * 40.0) * 0.5 + 0.5);
  let awn_mask = rect_mask(uv, px0 - 0.02, px1 + 0.02, aw_y0, aw_y1 - scallop, 0.006);
  let stripe = step(0.5, fract(uv.x * 10.0));
  var awn_col = mix(awn, vec3f(0.90, 0.88, 0.82), stripe * 0.85);
  awn_col = awn_col * (0.78 + 0.22 * smoothstep(aw_y0, aw_y1, uv.y)); // top-shade
  col = mix(col, awn_col, awn_mask);
  return sat3(col);
}
