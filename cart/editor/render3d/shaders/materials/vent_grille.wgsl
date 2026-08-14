// @material vent_grille
// @slug vent-grille
// @name Vent Grille
// @board metal_yard
// @variant-labels Clean Aluminum, Dusty Beige, Rusted Out
// @kind surface
// @tags metal_yard, vent, louver, dust
// @author fable-machine_yard
fn vent_grille(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.58, 0.60, 0.62);
  var slotTone = vec3f(0.08, 0.09, 0.10);
  var dustTone = vec3f(0.55, 0.48, 0.36);
  var slats = 9.0;
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.64, 0.58, 0.44);
    dustTone = vec3f(0.42, 0.34, 0.24);
    slats = 7.0;
  } else if (variant >= 1.5) {
    body = vec3f(0.36, 0.29, 0.24);
    slotTone = vec3f(0.05, 0.04, 0.04);
    dustTone = vec3f(0.28, 0.18, 0.12);
    slats = 11.0;
  }
  let inner = rect_mask(uv, 0.07, 0.93, 0.08, 0.92, 0.012);
  let fy = fract(uv.y * slats + fract(seed * 0.173));
  let louver = smoothstep(0.06, 0.30, fy) * (1.0 - smoothstep(0.55, 0.86, fy));
  let gap = smoothstep(0.86, 0.94, fy);
  var col = body * (0.45 + 0.75 * louver);
  col = mix(col, slotTone, gap);
  let brush = fbm(uv.x * 40.0, uv.y * 6.0 + seed, 3.0) * 0.5 + 0.5;
  col = col * (0.9 + 0.2 * brush);
  let dust = smoothstep(0.5, 0.85, fbm(uv.x * 9.0 + seed * 0.31, uv.y * 9.0, 3.0) * 0.5 + 0.5);
  col = mix(col, dustTone, dust * 0.35 * (1.0 - louver));
  let frameTone = body * 0.82 + vec3f(0.04, 0.04, 0.05);
  col = mix(frameTone * (0.7 + 0.3 * brush), col, inner);
  col = col + vec3f(0.30, 0.30, 0.28) * speckle(px, 3.0, seed, 0.985) * 0.4;
  return sat3(col);
}
