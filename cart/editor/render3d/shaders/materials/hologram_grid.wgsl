// @material hologram_grid
// @slug hologram-grid
// @name Hologram Grid
// @board neon_surface
// @variant-labels Blue Ghost, Amber Archive, Glitching Feed
// @kind gradient
// @tags neon_surface, hologram, glow, grid
// @author fable-scifi_hull
fn hologram_grid(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.01, 0.03, 0.08);
  var linec = vec3f(0.25, 0.75, 0.95);
  var hot = vec3f(0.70, 0.95, 1.00);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.06, 0.03, 0.01);
    linec = vec3f(0.95, 0.65, 0.20);
    hot = vec3f(1.00, 0.90, 0.60);
  } else if (variant >= 1.5) {
    deep = vec3f(0.02, 0.01, 0.06);
    linec = vec3f(0.55, 0.30, 0.95);
    hot = vec3f(0.90, 0.70, 1.00);
  }
  var guv = uv;
  if (variant >= 1.5) {
    let band = floor(uv.y * 24.0 + seed);
    guv.x = guv.x + (rand(vec2f(band, seed)) - 0.5) * 0.06 * step(0.7, rand(vec2f(band, seed * 3.0)));
  }
  let n = 11.0;
  let gx = abs(fract(guv.x * n + seed * 0.11) - 0.5);
  let gy = abs(fract(guv.y * n + seed * 0.07) - 0.5);
  let lx = exp(-gx * gx * 900.0);
  let ly = exp(-gy * gy * 900.0);
  let grid = max(lx, ly);
  let glow = exp(-gx * gx * 60.0) * 0.4 + exp(-gy * gy * 60.0) * 0.4;
  var col = deep;
  col = col + linec * glow * 0.5;
  col = col + linec * grid * 0.9;
  let node = exp(-(gx * gx + gy * gy) * 700.0);
  col = col + hot * node * 0.8;
  let flick = snoise(floor(uv.y * 40.0) * 0.7, seed * 2.3) * 0.5 + 0.5;
  col = col * (0.75 + flick * 0.35);
  let scan = sin(uv.y * 260.0 + seed * 9.0) * 0.5 + 0.5;
  col = col * (0.85 + scan * 0.15);
  let fade = 1.0 - smoothstep(0.2, 1.1, length(uv - vec2f(0.5, 0.45)));
  col = mix(deep * 0.6, col, fade * 0.7 + 0.3);
  return sat3(col);
}
