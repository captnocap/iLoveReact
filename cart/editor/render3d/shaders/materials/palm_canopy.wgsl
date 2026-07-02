// @material palm_canopy
// @slug palm-canopy
// @name Palm Canopy
// @board neon_surface
// @variant-labels Lush, Dry, Silhouette
// @kind surface
// @tags neon_surface, palm, canopy
// @author legacy
fn palm_canopy(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Frond fan against dusk — the PalmTree thingymajiger's canopy face. 0 lush,
  // 1 dry, 2 silhouette (against a hotter sky).
  var sky = mix(vec3f(0.86, 0.34, 0.42), vec3f(0.18, 0.10, 0.34), uv.y);
  var frond_lo = vec3f(0.04, 0.22, 0.10);
  var frond_hi = vec3f(0.20, 0.62, 0.24);
  if (variant > 0.5 && variant < 1.5) {
    frond_lo = vec3f(0.24, 0.18, 0.06);
    frond_hi = vec3f(0.58, 0.46, 0.16);
  } else if (variant >= 1.5) {
    frond_lo = vec3f(0.02, 0.02, 0.04);
    frond_hi = vec3f(0.06, 0.07, 0.10);
    sky = mix(vec3f(0.98, 0.56, 0.30), vec3f(0.30, 0.14, 0.40), uv.y);
  }
  let center = vec2f(0.5, 0.92);
  let rel = uv - center;
  let ang = atan2(rel.x, -rel.y);
  let rad = length(rel * vec2f(1.0, 0.8));
  let blades = sin(ang * 9.0 + sin(rad * 6.0 + seed) * 1.5);
  let blade_mask = smoothstep(0.1, 0.5, blades) * smoothstep(0.92, 0.30, rad) * step(rad, 0.95);
  let serr = 0.7 + 0.3 * sin(rad * 60.0);
  let f = mix(frond_lo, frond_hi, smoothstep(0.0, 0.6, rad) * serr);
  var col = mix(sky, f, blade_mask);
  let trunk = (1.0 - smoothstep(0.02, 0.05, abs(rel.x))) * step(0.55, uv.y);
  col = mix(col, vec3f(0.22, 0.15, 0.08), trunk * 0.8);
  return sat3(col);
}
