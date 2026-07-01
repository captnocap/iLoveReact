// @material asphalt
// @slug asphalt
// @name Asphalt
// @board second_pass
// @variant-labels Double Yellow, Crosswalk + Manhole, Oil + Skids
// @kind surface
// @tags second_pass, asphalt
// @author legacy
fn asphalt(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Aggregate base + iridescent oil + manhole + tire skids. The road re-do.
  let agg = fbm(uv.x * 35.0 + seed, uv.y * 35.0 - seed, 4.0) * 0.5 + 0.5;
  let stone = speckle(px, 1.4, seed, 0.78);
  var col = mix(vec3f(0.06, 0.065, 0.06), vec3f(0.18, 0.19, 0.17), agg);
  col = col + vec3f(0.08, 0.08, 0.07) * stone;

  // Oil slick — iridescent SDF ellipse.
  let oil_uv = uv - vec2f(0.35, 0.62);
  let oil_r = length(oil_uv * vec2f(1.4, 0.8));
  let oil = 1.0 - smoothstep(0.08, 0.14, oil_r);
  let oil_ang = atan2(oil_uv.y, oil_uv.x);
  let irid = vec3f(0.5 + 0.5*sin(oil_ang*3.0 + seed), 0.5 + 0.5*sin(oil_ang*3.0 + 2.0 + seed), 0.5 + 0.5*sin(oil_ang*3.0 + 4.0 + seed));
  col = mix(col, irid * 0.55 + col * 0.45, oil * 0.48);

  // Manhole cover — polar SDF ring + bolts.
  let mh_uv = uv - vec2f(0.68, 0.28);
  let mh_r = length(mh_uv);
  let mh_ring = line_near(mh_r - 0.08, 0.008) + line_near(mh_r - 0.05, 0.005);
  let mh_ang = atan2(mh_uv.y, mh_uv.x);
  let mh_bolts = line_near(sin(mh_ang * 6.0), 0.08) * step(0.04, mh_r) * (1.0 - step(0.07, mh_r));
  let mh = sat(mh_ring + mh_bolts) * step(mh_r, 0.10);
  col = mix(col, vec3f(0.22, 0.20, 0.18), mh * 0.85);

  // Tire skid marks — directional streaks.
  let skid = line_near(sin((uv.x + fbm(uv.x * 2.0, uv.y * 2.0 + seed, 3.0) * 0.03) * 45.0), 0.06) * smoothstep(0.65, 0.95, uv.y);
  col = mix(col, vec3f(0.03, 0.03, 0.03), skid * 0.42);

  if (variant < 0.5) {
    let dline = line_near(uv.x - 0.50, 0.018);
    let dash = step(0.4, fract(uv.y * 6.0));
    col = mix(col, vec3f(0.92, 0.78, 0.22), dline * dash * 0.9);
  } else if (variant < 1.5) {
    let cross = line_near(sin(uv.x * 18.0), 0.10) * smoothstep(0.35, 0.45, uv.y) * smoothstep(0.55, 0.45, uv.y);
    col = mix(col, vec3f(0.88, 0.88, 0.82), cross * 0.8);
    col = mix(col, vec3f(0.28, 0.26, 0.24), mh * 0.9);
  } else {
    let oil2 = 1.0 - smoothstep(0.06, 0.12, length((uv - vec2f(0.72, 0.55)) * vec2f(1.2, 0.9)));
    col = mix(col, irid * 0.45 + col * 0.55, oil2 * 0.38);
    let skid2 = line_near(sin((uv.x + 0.1) * 55.0 + seed), 0.04) * smoothstep(0.40, 0.80, uv.y);
    col = mix(col, vec3f(0.025, 0.025, 0.025), skid2 * 0.32);
  }
  return sat3(col);
}
