// @material lava_plasma
// @slug lava-plasma
// @name Lava Plasma
// @board neon_surface
// @variant-labels Classic Wave, Fast Storm, Slow Churn
// @kind surface
// @tags neon_surface, plasma, lava, animated
// @author editor
fn lava_plasma(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var primary = vec3f(0.93, 0.20, 0.78);
  var secondary = vec3f(0.15, 0.83, 0.90);
  var tertiary = vec3f(0.98, 0.86, 0.25);
  // Variants retune the MOTION, not the palette (slots recolor it): the classic
  // demo wave, a fast fine-grained storm, and the lavalamp's slow fat blobs.
  var speed = 0.55;
  var scale = 3.0;
  if (variant > 0.5 && variant < 1.5) {
    speed = 1.4;
    scale = 5.0;
  } else if (variant >= 1.5) {
    speed = 0.22;
    scale = 2.1;
  }
  let t = U.time * speed + seed * 0.7;
  let p = uv * scale;
  // The four-wave sine plasma (runtime/effects/Plasma.tsx, as a catalog fill):
  // two directional waves, one orbiting radial wave, one counter-phase wave.
  let v1 = sin(p.x * 1.7 + t);
  let v2 = sin((p.y + p.x) * 1.1 + t * 1.3);
  let v3 = sin(length(p - vec2f(sin(t * 0.43) * 2.0, cos(t * 0.37) * 2.0)) * 1.9);
  let v4 = sin(p.y * 2.3 - t * 0.8);
  let a = (v1 + v2 + v3 + v4) * 0.25 * 3.14159265;
  var col = primary * (0.5 + 0.5 * sin(a));
  col = col + secondary * (0.5 + 0.5 * sin(a + 2.094));
  col = col + tertiary * (0.5 + 0.5 * cos(a + 4.188));
  return sat3(col * 0.62);
}
