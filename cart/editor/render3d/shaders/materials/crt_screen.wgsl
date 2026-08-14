// @material crt_screen
// @slug crt-screen
// @name CRT Screen
// @board neon_surface
// @variant-labels Terminal Green, Web Blue, Dead Static
// @kind surface
// @tags neon_surface, crt, screen
// @author legacy
fn crt_screen(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Monitor / phone / darknet-cafe glow: phosphor scanlines, glyph-noise text
  // rows, triad mask, rolling refresh. The dead-internet surfaces rendered as a
  // texture. 0 terminal-green, 1 web-blue, 2 dead-static.
  let roll = U.time * 0.15;
  var phos = vec3f(0.10, 0.95, 0.30);
  var bg = vec3f(0.01, 0.04, 0.02);
  if (variant > 0.5 && variant < 1.5) { phos = vec3f(0.30, 0.70, 1.0); bg = vec3f(0.01, 0.02, 0.05); }
  else if (variant >= 1.5) { phos = vec3f(0.80, 0.80, 0.80); bg = vec3f(0.02, 0.02, 0.02); }
  let cols = 28.0;
  let rows = 18.0;
  let cell = floor(vec2f(uv.x * cols, uv.y * rows));
  var lit = step(0.55, rand(cell + vec2f(seed, floor(roll * 6.0))));
  lit = lit * step(0.25, rand(vec2f(cell.y, seed)));
  var col = mix(bg, phos, lit * (0.5 + 0.5 * rand(cell + vec2f(3.0, 7.0))));
  if (variant >= 1.5) {
    let snow = rand(px + vec2f(floor(U.time * 50.0), seed));
    col = mix(vec3f(snow, snow, snow), col, 0.2);
  }
  let scan = 0.7 + 0.3 * (sin((uv.y + roll) * rows * 6.2831) * 0.5 + 0.5);
  col = col * scan;
  let triad = fract(uv.x * cols * 3.0);
  let rgbmask = vec3f(smoothstep(0.66, 0.34, triad), 1.0 - abs(triad - 0.5) * 2.0, smoothstep(0.34, 0.66, triad));
  col = col * (0.7 + 0.3 * rgbmask);
  let cdist = length((uv - vec2f(0.5, 0.5)) * vec2f(1.1, 1.2));
  col = col * (1.0 - smoothstep(0.45, 0.72, cdist));
  return sat3(col);
}
