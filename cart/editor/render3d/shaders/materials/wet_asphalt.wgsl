// @material wet_asphalt
// @slug wet-asphalt
// @name Wet Asphalt
// @board neon_surface
// @variant-labels Neon Puddle, Orange, Oil Slick
// @kind surface
// @tags neon_surface, wet, asphalt
// @author legacy
fn wet_asphalt(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Night street with neon puddle reflections — the road zone after the dream
  // turns wet. variant 2 is an oil slick (rainbow interference).
  let grain = fbm(uv.x * 22.0 + seed, uv.y * 22.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.02, 0.02, 0.025), vec3f(0.09, 0.09, 0.10), grain);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 2.5, seed, 0.94);
  let puddle = smoothstep(0.55, 0.75, fbm(uv.x * 4.0 + seed, uv.y * 4.0 - seed, 5.0) * 0.5 + 0.5);
  let smear = fbm(uv.x * 5.0 + seed * 2.0, uv.y * 1.2, 4.0) * 0.5 + 0.5;
  var neon = mix(vec3f(0.95, 0.12, 0.55), vec3f(0.10, 0.85, 0.92), smear);
  if (variant > 0.5 && variant < 1.5) {
    neon = mix(vec3f(0.10, 0.85, 0.92), vec3f(0.98, 0.62, 0.16), smear);
  } else if (variant >= 1.5) {
    let ang = fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0);
    neon = vec3f(0.5 + 0.5 * sin(ang * 6.0), 0.5 + 0.5 * sin(ang * 6.0 + 2.0), 0.5 + 0.5 * sin(ang * 6.0 + 4.0));
  }
  let vstreak = 0.4 + 0.6 * (sin(uv.y * 30.0 + smear * 8.0) * 0.5 + 0.5);
  col = mix(col, neon, puddle * 0.55 * vstreak);
  col = col + vec3f(0.18, 0.18, 0.18) * puddle * smoothstep(0.7, 0.95, smear);
  return sat3(col);
}
