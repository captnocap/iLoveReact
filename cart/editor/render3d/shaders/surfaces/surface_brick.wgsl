// @surface surface_brick
// @name Brick Relief
// @tags brick, masonry, environment, structure
// @author fable
// @param relief: f32 = 0.012 range(0.0, 0.08) "Relief depth"
// @param brick_length: f32 = 1.0 range(0.05, 2.0) "Brick length (sp units)"
// @param course_height: f32 = 1.0 range(0.05, 2.0) "Course height (sp units)"
//
// The structural field behind the Brick material (Surface Packages v1,
// PROJECTED_SURFACE_INTEGRATION.md). The cell/mortar/tone math here is the
// EXACT structure materials/brick.wgsl computed inline before extraction —
// the material now calls this module and shades its features, so the color
// preview and any projected geometry can never disagree about where a brick
// ends and mortar begins.
//
// sp is a CONTINUOUS brick-grid coordinate. With the default 1.0 sizes, one
// unit = one course vertically, one brick length horizontally — the 2D
// material adapter feeds (uv.x * cols, uv.y * rows), identical values to its
// old inline math. A Surface Package feeds real run METERS and sets
// brick_length / course_height to physical sizes, so the cell address (and
// every hash) continues across an entire wall run with real-world bricks
// (measured size IS scale — req_4562).
//
// feat = (mortar, tone, near_x, near_y). height projects brick faces from a
// recessed mortar plane in the same DOMAIN units as sp; the default relief is
// meters-minded (12mm faces over raked joints) for the package consumer, and
// the 2D adapter simply never reads height.
fn surface_brick(sp: vec2f, seed: f32) -> SurfaceSample {
  let grid = vec2f(sp.x / brick_length, sp.y / course_height);
  let row = floor(grid.y);
  let offset = (row - floor(row * 0.5) * 2.0) * 0.5;
  let buv = vec2f(grid.x + offset, grid.y);
  let cell = floor(buv);
  let local = fract(buv);
  let near_x = min(local.x, 1.0 - local.x);
  let near_y = min(local.y, 1.0 - local.y);
  let mortar = max(1.0 - smoothstep(0.030, 0.055, near_x), 1.0 - smoothstep(0.035, 0.065, near_y));
  let tone = rand(cell + vec2f(seed, seed * 2.0));

  // Structural relief (new signal — invisible to the 2D adapter): each brick
  // face rises from the mortar plane through the same smoothstep windows the
  // color mortar uses, with a hashed per-brick projection and a gentle bow.
  let face = smoothstep(0.030, 0.055, near_x) * smoothstep(0.035, 0.065, near_y);
  let face_depth = 0.76 + rand(cell + vec2f(seed * 1.3, seed * 2.9)) * 0.30;
  let bow = sin(3.14159265 * local.x) * sin(3.14159265 * local.y);
  let height = relief * face * (face_depth + bow * 0.09) - relief * 0.075;

  return SurfaceSample(height, cell, vec4f(mortar, tone, near_x, near_y));
}
