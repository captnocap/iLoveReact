// @material beadboard_wainscot
// @slug beadboard-wainscot
// @name Beadboard Wainscot
// @board liminal
// @variant-labels Farmhouse White, Sage Parlor, Dusty Porch Blue
// @kind surface
// @tags liminal, wainscot, panel, paint
// @author fable-interior_home
fn beadboard_wainscot(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paint = vec3f(0.90, 0.88, 0.83);
  var shadow_tone = vec3f(0.62, 0.60, 0.55);
  if (variant > 0.5 && variant < 1.5) {
    paint = vec3f(0.60, 0.69, 0.56);
    shadow_tone = vec3f(0.36, 0.44, 0.34);
  } else if (variant >= 1.5) {
    paint = vec3f(0.55, 0.65, 0.72);
    shadow_tone = vec3f(0.32, 0.40, 0.48);
  }
  let bx = fract(uv.x * 11.0 + fract(seed * 0.09));
  let prof = sin(bx * 3.14159) * 0.5 + 0.5;
  let groove = 1.0 - smoothstep(0.0, 0.07, min(bx, 1.0 - bx));
  var col = mix(paint * 0.92, paint * 1.05, prof);
  col = mix(col, shadow_tone, groove * 0.7);
  let rail = 1.0 - smoothstep(0.14, 0.16, uv.y);
  col = mix(col, paint * 1.04, rail);
  col = mix(col, shadow_tone, line_near(uv.y - 0.165, 0.012) * 0.8);
  col = col + vec3f(0.07) * line_near(uv.y - 0.04, 0.015);
  let brush = fbm(uv.x * 4.0, uv.y * 40.0 + seed, 3.0) * 0.5 + 0.5;
  col = col + vec3f((brush - 0.5) * 0.05);
  let chip = speckle(px, 3.0, seed, 0.965) * smoothstep(0.5, 1.0, uv.y);
  col = mix(col, vec3f(0.45, 0.33, 0.22), chip * 0.8);
  col = mix(col, shadow_tone, smoothstep(0.85, 1.0, uv.y) * 0.25 * (fbm(uv.x * 7.0, seed, 3.0) * 0.5 + 0.5));
  return sat3(col);
}
