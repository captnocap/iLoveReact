// @material road
// @slug road
// @name Road
// @board environment
// @variant-labels Yellow Divider, White Lane + Edge, Plain Asphalt
// @kind surface
// @tags environment, road
// @author legacy
fn road_apply_markings(base: vec3f, uv: vec2f, meters: vec2f, marking: f32) -> vec3f {
  let flags = i32(floor(marking + 0.5));
  var col = base;

  // Longitudinal dashes are measured in metres, not restarted per 1 m tile.
  // The 3 m cadence is deliberately commensurate with the ruled lane module.
  let dash_phase = fract(meters.y / 3.0);
  let dash = step(0.32, dash_phase) * step(dash_phase, 0.82);
  let low_edge = line_near(uv.x, 0.070);
  let high_edge = line_near(uv.x - 1.0, 0.070);

  var white = 0.0;
  if ((flags & 4) != 0) { white = max(white, low_edge * dash); }
  if ((flags & 8) != 0) { white = max(white, high_edge * dash); }
  if ((flags & 16) != 0) { white = max(white, low_edge); }
  if ((flags & 32) != 0) { white = max(white, high_edge); }
  col = mix(col, vec3f(0.93, 0.94, 0.90), white * 0.92);

  if ((flags & 2) != 0) {
    let center = line_near(uv.x - 0.50, 0.030) * dash;
    col = mix(col, vec3f(0.96, 0.74, 0.26), center * 0.94);
  }

  // The road planner emits a two-metre-deep band. Alternating half-metre
  // stripes across that band read as one zebra instead of one decal per tile.
  if ((flags & 64) != 0) {
    let zebra_phase = fract(meters.y * 2.0);
    let zebra = step(0.14, zebra_phase) * step(zebra_phase, 0.72);
    col = mix(col, vec3f(0.91, 0.91, 0.86), zebra * 0.84);
  }
  return sat3(col);
}

fn road(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let coarse = fbm(uv.x * 18.0 + seed, uv.y * 18.0 - seed, 5.0) * 0.5 + 0.5;
  let tar = fbm(uv.x * 5.0 - seed * 0.4, uv.y * 11.0 + seed * 0.3, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.030, 0.033, 0.034), vec3f(0.125, 0.128, 0.122), coarse);
  col = mix(col, vec3f(0.012, 0.014, 0.015), smoothstep(0.72, 0.98, tar) * 0.38);
  col = col + vec3f(0.13, 0.13, 0.12) * speckle(px, 2.4, seed, 0.948);
  col = col - vec3f(0.045, 0.043, 0.040) * speckle(px + vec2f(19.0, 7.0), 3.5, seed, 0.955);
  col = col - vec3f(0.055, 0.054, 0.052) * crack_field(uv, seed, 8.0);
  if (variant < 0.5) {
    return road_apply_markings(col, uv, uv * vec2f(1.0, 6.0), 2.0);
  } else if (variant < 1.5) {
    // A complete 3 m lane preview: dashed split on one side, solid road edge
    // on the other. The road compiler chooses the exact edge flags in-world.
    return road_apply_markings(col, uv, uv * vec2f(3.0, 6.0), 36.0);
  }
  return sat3(col);
}
