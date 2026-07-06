// @material rose_gold
// @slug rose-gold
// @name Rose Gold
// @board neon_surface
// @variant-labels Mirror Blush, Satin Sweep, Smoked Copper
// @kind surface
// @tags neon_surface, metal, brushed, pink
// @author fable-gems_precious
fn rose_gold(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.85, 0.62, 0.54);
  var shade = vec3f(0.52, 0.32, 0.28);
  var glint = vec3f(1.0, 0.88, 0.80);
  var ang = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    ang = 0.8; body = vec3f(0.78, 0.55, 0.46); shade = vec3f(0.40, 0.24, 0.22);
  } else if (variant >= 1.5) {
    ang = 1.6; body = vec3f(0.64, 0.43, 0.38); shade = vec3f(0.29, 0.17, 0.16);
    glint = vec3f(0.92, 0.74, 0.66);
  }
  let along = uv.x * cos(ang) + uv.y * sin(ang);
  let across = uv.y * cos(ang) - uv.x * sin(ang);
  let brush = fbm(across * 90.0 + seed, along * 3.0, 4.0) * 0.5 + 0.5;
  var col = mix(shade, body, 0.35 + 0.65 * brush);
  let drift = snoise(seed * 0.31, 1.7) * 0.2;
  let sheen = exp(-pow((along - 0.5 + drift) * 4.0, 2.0));
  col = mix(col, glint, sheen * 0.45);
  let lane = floor(across * 17.0 + seed);
  let scr = line_near(fract(across * 17.0 + seed) - 0.5, 0.02) * step(0.78, rand(vec2f(lane, seed * 0.11)));
  col = mix(col, glint, scr * 0.5);
  col += vec3f(1.0, 0.90, 0.85) * speckle(px, 2.0, seed, 0.997) * 0.35;
  return sat3(col);
}
