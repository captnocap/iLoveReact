// @material exposed_joists
// @slug exposed-joists
// @name Exposed Joists
// @board liminal
// @variant-labels Dark Attic, Whitewashed Loft, Lamp Glow
// @kind surface
// @tags liminal, ceiling, wood, beams
// @author fable-interior_home
fn exposed_joists(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var beam_lo = vec3f(0.34, 0.24, 0.15);
  var beam_hi = vec3f(0.55, 0.40, 0.26);
  var cavity = vec3f(0.10, 0.09, 0.08);
  var cable = vec3f(0.82, 0.79, 0.72);
  if (variant > 0.5 && variant < 1.5) {
    beam_lo = vec3f(0.68, 0.66, 0.60);
    beam_hi = vec3f(0.86, 0.84, 0.78);
    cavity = vec3f(0.35, 0.34, 0.32);
    cable = vec3f(0.22, 0.22, 0.24);
  } else if (variant >= 1.5) {
    beam_lo = vec3f(0.45, 0.28, 0.14);
    beam_hi = vec3f(0.75, 0.52, 0.28);
    cavity = vec3f(0.20, 0.12, 0.07);
    cable = vec3f(0.16, 0.14, 0.13);
  }
  let jx = fract(uv.x * 3.0 + fract(seed * 0.07));
  let half_d = abs(jx - 0.5);
  let joist = 1.0 - smoothstep(0.16, 0.185, half_d);
  let grain = fbm(uv.x * 40.0 + seed, uv.y * 4.0, 3.0) * 0.5 + 0.5;
  let beam = mix(beam_lo, beam_hi, grain);
  let edge_shade = smoothstep(0.185, 0.10, half_d);
  var col = mix(cavity + vec3f(fbm(uv.x * 8.0, uv.y * 8.0 + seed, 3.0) * 0.06), beam * (0.7 + edge_shade * 0.35), joist);
  col = mix(col, beam_lo * 0.6, joist * line_near(half_d - 0.16, 0.015));
  let knot = speckle(px, 4.0, seed, 0.985) * joist;
  col = mix(col, beam_lo * 0.5, knot * 0.8);
  let wy = 0.45 + 0.07 * sin(uv.x * 6.5 + seed * 0.3);
  let wire = 1.0 - smoothstep(0.006, 0.014, abs(uv.y - wy));
  col = mix(col, cable, wire * 0.95);
  let staple = dot_mark(uv, vec2f(0.5, wy), 0.012) * joist;
  col = mix(col, vec3f(0.60, 0.60, 0.62), staple);
  return sat3(col);
}
