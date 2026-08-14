// @material brick_fire_escape
// @slug brick-fire-escape
// @name Brick + Fire Escape
// @board facades
// @variant-labels Black Iron, Rust, Worn Grey
// @kind composition
// @tags facades, brick, fire
// @author legacy
fn brick_fire_escape(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Red-brick apartment face with a painted fire escape: two vertical stringers,
  // a landing platform at each floor, rail pickets, and a drop ladder. variant
  // 0 black iron, 1 rust, 2 worn grey.
  var col = brick_facade(uv, px, 0.0, seed);
  var iron = vec3f(0.09, 0.09, 0.10);
  if (variant > 0.5 && variant < 1.5) {
    iron = vec3f(0.34, 0.15, 0.075);
  } else if (variant >= 1.5) {
    iron = vec3f(0.20, 0.21, 0.20);
  }
  let band = step(0.18, uv.x) * step(uv.x, 0.82); // structure spans the middle
  // Vertical stringers.
  let v1 = 1.0 - smoothstep(0.009, 0.018, abs(uv.x - 0.28));
  let v2 = 1.0 - smoothstep(0.009, 0.018, abs(uv.x - 0.72));
  let stringers = max(v1, v2) * band;
  // Landing platforms at each floor (floor lines at y = 0.0/0.5/1.0; landings
  // painted at the sill height of each window: y ~ 0.34 and 0.84).
  let ly = min(abs(uv.y - 0.34), abs(uv.y - 0.84));
  let landing = (1.0 - smoothstep(0.012, 0.024, ly)) * band;
  // Rail pickets just above each landing.
  let above = step(0.0, uv.y - 0.34) * step(uv.y - 0.34, 0.085) + step(0.0, uv.y - 0.84) * step(uv.y - 0.84, 0.085);
  let pickets = (1.0 - smoothstep(0.006, 0.012, abs(fract(uv.x * 16.0) - 0.5))) * clamp(above, 0.0, 1.0) * band;
  // Diagonal drop ladder on the left bay between the two landings.
  let lad = abs((uv.x - 0.28) - (uv.y - 0.34) * 0.30);
  let ladder = (1.0 - smoothstep(0.010, 0.020, lad)) * step(0.34, uv.y) * step(uv.y, 0.84);
  let iron_mask = sat(max(max(stringers, landing), max(pickets, ladder)));
  // Soft contact shadow cast onto the brick just right of and below the iron.
  let shadow = sat(max(stringers, landing)) * 0.5;
  col = col * (1.0 - 0.18 * shadow * smoothstep(0.0, 0.02, abs(uv.x - 0.30)));
  col = mix(col, iron * (0.85 + 0.15 * rand(floor(px * 0.18) + vec2f(seed, seed))), iron_mask);
  return sat3(col);
}
