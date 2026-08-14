// @material brick_entrance
// @slug brick-entrance
// @name Brick Entrance
// @board facades
// @variant-labels Stoop, Recessed, Double Door
// @kind composition
// @tags facades, brick, entrance
// @author legacy
fn brick_entrance(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Residential building entryway: a stone-surround door with a transom light,
  // an upper-floor window above, a coach lamp beside the door. variant 0 stoop
  // (stone steps), 1 recessed dark reveal, 2 glazed double door.
  var col = brick_wall(uv, px, vec3f(0.42, 0.13, 0.085), vec3f(0.78, 0.30, 0.17), vec3f(0.56, 0.54, 0.49), seed);
  let aa = 0.007;
  // Stone surround around the entrance, then the recessed reveal inside it.
  let surround = rect_mask(uv, 0.28, 0.72, 0.0, 0.50, aa);
  col = mix(col, vec3f(0.66, 0.63, 0.57), surround);
  let reveal = rect_mask(uv, 0.34, 0.66, 0.0, 0.46, aa);
  var reveal_c = vec3f(0.22, 0.18, 0.16);
  if (variant > 0.5 && variant < 1.5) { reveal_c = vec3f(0.07, 0.06, 0.07); }
  col = mix(col, reveal_c, reveal);
  // Door leaf with two recessed panels.
  var door = vec3f(0.34, 0.16, 0.10);
  if (variant > 0.5 && variant < 1.5) { door = vec3f(0.12, 0.11, 0.12); }
  else if (variant >= 1.5) { door = vec3f(0.16, 0.18, 0.22); }
  let door_mask = rect_mask(uv, 0.37, 0.63, 0.02, 0.40, aa);
  let dx = (uv.x - 0.37) / 0.26;
  let dy = (uv.y - 0.02) / 0.38;
  let panel_line = max(1.0 - smoothstep(0.020, 0.040, abs(dx - 0.5)), 1.0 - smoothstep(0.020, 0.040, abs(dy - 0.5)));
  var doorcol = mix(door, door * 0.6, panel_line);
  if (variant >= 1.5) {
    // Glazed double door: warm interior behind the glass, central mullion.
    doorcol = mix(doorcol, vec3f(0.86, 0.69, 0.40), 0.5);
    doorcol = mix(doorcol, vec3f(0.14, 0.13, 0.12), 1.0 - smoothstep(0.010, 0.020, abs(dx - 0.5)));
  }
  col = mix(col, doorcol, door_mask);
  // Brass knob.
  let knob = 1.0 - smoothstep(0.008, 0.014, length(uv - vec2f(0.60, 0.20)));
  col = mix(col, vec3f(0.85, 0.74, 0.35), knob * (1.0 - step(1.5, variant)));
  // Transom light above the door.
  let transom = rect_mask(uv, 0.37, 0.63, 0.41, 0.455, aa);
  col = mix(col, vec3f(0.92, 0.76, 0.42), transom);
  // Stone steps (stoop variant).
  if (variant < 0.5) {
    let step1 = rect_mask(uv, 0.26, 0.74, 0.0, 0.022, aa);
    let step2 = rect_mask(uv, 0.29, 0.71, 0.022, 0.045, aa);
    col = mix(col, vec3f(0.60, 0.57, 0.52), max(step1, step2));
  }
  // Coach lamp glow beside the door.
  let lamp = 1.0 - smoothstep(0.0, 0.03, length((uv - vec2f(0.30, 0.42)) * vec2f(1.0, 1.2)));
  col = col + vec3f(0.55, 0.42, 0.20) * lamp;
  // Upper-floor window, mapped into the band above the entrance.
  let g = vec2f((uv.x - 0.30) / 0.40, (uv.y - 0.60) / 0.34);
  let w = paint_window(g, 1.0, seed);
  col = mix(col, w.rgb, w.a);
  return sat3(col);
}
