// @material rose_quartz
// @slug rose-quartz
// @name Rose Quartz
// @board neon_surface
// @variant-labels Pale Milk, Dusty Deep, Lavender Rose
// @kind surface
// @tags neon_surface, quartz, pink, milky
// @author fable-gems_precious
fn rose_quartz(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.94, 0.78, 0.80);
  var milk = vec3f(0.98, 0.92, 0.92);
  var core = vec3f(0.85, 0.58, 0.63);
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.85, 0.62, 0.64); milk = vec3f(0.93, 0.80, 0.80); core = vec3f(0.68, 0.40, 0.45);
  } else if (variant >= 1.5) {
    body = vec3f(0.88, 0.74, 0.86); milk = vec3f(0.96, 0.90, 0.96); core = vec3f(0.72, 0.52, 0.72);
  }
  let cloud_a = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 5.0) * 0.5 + 0.5;
  let cloud_b = fbm(uv.x * 12.0, uv.y * 12.0 + seed * 0.6, 4.0) * 0.5 + 0.5;
  var col = mix(core, body, cloud_a);
  col = mix(col, milk, cloud_b * 0.45);
  let frac_m = crack_field(uv, seed + 5.0, 3.0);
  col = mix(col, milk * 1.05, frac_m * 0.5);
  let vein = line_near(sin((uv.x * 0.8 + uv.y + cloud_a * 0.3) * 10.0 + seed), 0.08);
  col = mix(col, core * 0.92, vein * 0.30);
  let glow = exp(-length(uv - vec2f(0.45, 0.5)) * 1.8);
  col = mix(col, milk, glow * 0.20);
  col += vec3f(1.0, 0.96, 0.96) * speckle(px, 2.0, seed, 0.997) * 0.25;
  return sat3(col);
}
