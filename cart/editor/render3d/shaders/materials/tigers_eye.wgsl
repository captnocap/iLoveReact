// @material tigers_eye
// @slug tigers-eye
// @name Tigers Eye
// @board neon_surface
// @variant-labels Classic Amber, Red Ox, Hawk Blue
// @kind surface
// @tags neon_surface, chatoyant, banded, amber
// @author fable-gems_precious
fn tigers_eye(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.24, 0.12, 0.04);
  var hi = vec3f(0.85, 0.56, 0.18);
  var eye = vec3f(1.0, 0.85, 0.45);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.26, 0.07, 0.04); hi = vec3f(0.72, 0.28, 0.12); eye = vec3f(0.95, 0.60, 0.35);
  } else if (variant >= 1.5) {
    lo = vec3f(0.05, 0.10, 0.20); hi = vec3f(0.28, 0.46, 0.66); eye = vec3f(0.62, 0.82, 0.98);
  }
  let wob = fbm(uv.x * 3.0 + seed, uv.y * 8.0, 4.0) * 0.12;
  let wy = uv.y + wob;
  let bands = sin(wy * 26.0 + seed) * 0.5 + 0.5;
  var col = mix(lo, hi, bands);
  let fiber = fbm(uv.x * 6.0, wy * 160.0 + seed * 2.0, 3.0) * 0.5 + 0.5;
  col = mix(col * 0.78, col * 1.15, fiber);
  let eye_x = 0.35 + rand(vec2f(seed, 8.0)) * 0.3;
  let chat = exp(-pow((uv.x - eye_x + wob * 0.5) * 5.5, 2.0));
  col = mix(col, eye, chat * bands * 0.65);
  let seam_m = line_near(sin(wy * 26.0 + seed), 0.05);
  col = mix(col, lo * 0.6, seam_m * 0.4);
  col += eye * speckle(px, 2.0, seed, 0.997) * 0.25;
  return sat3(col);
}
