// @material fogged_mirror
// @slug fogged-mirror
// @name Fogged Mirror
// @board liminal
// @variant-labels Steam, Wiped Trails, Droplets
// @kind surface
// @tags liminal, fogged, mirror
// @author legacy
fn fogged_mirror(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Reflection gradient that implies a bathroom or cloakroom mirror.
  let refl = mix(vec3f(0.10, 0.12, 0.16), vec3f(0.68, 0.72, 0.78), smoothstep(0.0, 1.0, uv.y));
  // Mist layer: settled condensation + fresh droplets.
  let mist = fbm(uv.x * 7.0 + seed, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5;
  let drops = speckle(px, 3.2, seed, 0.86);
  // Wipe trails — fingers dragged through condensation, clearing narrow arcs.
  let trail1 = line_near(uv.y - 0.32 - sin(uv.x * 2.8 + seed) * 0.09, 0.022);
  let trail2 = line_near(uv.y - 0.58 - sin(uv.x * 2.2 + seed + 1.3) * 0.07, 0.018);
  let trail3 = line_near(uv.y - 0.78 - sin(uv.x * 3.5 + seed + 2.7) * 0.05, 0.014);
  let trails = sat(trail1 + trail2 + trail3);
  var col = mix(refl, vec3f(0.80, 0.82, 0.84), mist * 0.40);
  col = mix(col, refl, trails * 0.60);   // clearer where wiped
  col = mix(col, vec3f(0.88, 0.90, 0.92), drops * 0.28);
  // Cold-edge bleed at bottom — mirror frame chill.
  col = mix(col, vec3f(0.55, 0.60, 0.65), (1.0 - smoothstep(0.82, 1.0, uv.y)) * 0.18);
  return sat3(col);
}
