// @material charcoal_bed
// @slug charcoal-bed
// @name Charcoal Bed
// @board liminal
// @variant-labels Orange Ember, Yellow Coals, Red Coals
// @kind surface
// @tags liminal, charcoal, bed
// @author legacy
fn charcoal_bed(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Ember bed: porous char, crack-glow, ash dust, heat shimmer.
  let porous = fbm(uv.x * 16.0 + seed, uv.y * 16.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.03, 0.03, 0.03), vec3f(0.14, 0.12, 0.10), porous);
  // Glowing crack field — ember veins.
  let ember = crack_field(uv, seed + 3.0, 4.5) * smoothstep(0.25, 0.75, fbm(uv.x * 2.5, uv.y * 2.5 + seed, 3.0) * 0.5 + 0.5);
  var glow = vec3f(0.95, 0.32, 0.06);
  if (variant > 0.5 && variant < 1.5) {
    glow = vec3f(0.88, 0.52, 0.10);
  } else if (variant >= 1.5) {
    glow = vec3f(0.78, 0.22, 0.16);
  }
  col = mix(col, glow, ember * 0.72);
  // Ash powder — light grey settling on cooler regions.
  let ash = speckle(px, 2.4, seed, 0.76);
  col = mix(col, vec3f(0.68, 0.66, 0.62), ash * 0.28);
  // Heat shimmer tint in the highs.
  col = col + vec3f(0.05, 0.012, 0.0) * smoothstep(0.45, 0.88, ember);
  // Char ring marks — concentric burn circles.
  let ring = line_near(fract(length((uv - vec2f(0.5, 0.5)) * vec2f(1.1, 0.9)) * 3.5) - 0.5, 0.035);
  col = mix(col, vec3f(0.06, 0.05, 0.05), ring * 0.25);
  return sat3(col);
}
