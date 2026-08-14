// @material threaded_grid
// @slug threaded-grid
// @name Threaded Grid
// @board wallpapers
// @variant-labels Fine Thread, Broad Thread, Scrim Thread
// @kind surface
// @tags wallpapers, grid, thread
// @author editor
fn threaded_grid(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.86, 0.82, 0.74);
  var thread = vec3f(0.30, 0.38, 0.40);
  var shadow = vec3f(0.62, 0.59, 0.55);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.78, 0.74, 0.68);
    thread = vec3f(0.28, 0.22, 0.20);
    shadow = vec3f(0.42, 0.41, 0.37);
  } else if (variant >= 1.5) {
    base = vec3f(0.93, 0.91, 0.88);
    thread = vec3f(0.40, 0.35, 0.32);
    shadow = vec3f(0.86, 0.78, 0.71);
  }
  let gx = 1.0 - smoothstep(0.0, 0.012, abs(fract(uv.x * 18.0 + seed * 0.23) - 0.5));
  let gy = 1.0 - smoothstep(0.0, 0.012, abs(fract(uv.y * 22.0 + seed * 0.17) - 0.5));
  let weave = (gx * 0.5 + gy * 0.5) * (0.5 + 0.5 * sin(uv.x * 20.0 + uv.y * 16.0));
  let jitter = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(base, thread, smoothstep(0.22, 0.8, weave * (0.6 + jitter * 0.4)));
  col = mix(col, shadow, crack_field(uv + vec2f(seed * 0.4, seed * 0.08), seed + 5.0, 30.0));
  col = col + vec3f(0.03, 0.03, 0.03) * speckle(px, 1.8, seed + 9.0, 0.96);
  return sat3(col);
}

