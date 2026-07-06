// @material window_blinds
// @slug window-blinds
// @name Window Blinds
// @board liminal
// @variant-labels Afternoon Slats, Moonlit, Dusty Office
// @kind composition
// @tags liminal, blinds, window, light
// @author fable-interior_home
fn window_blinds(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var slat = vec3f(0.82, 0.81, 0.77);
  var glow = vec3f(0.98, 0.88, 0.62);
  var cord = vec3f(0.55, 0.52, 0.46);
  var glow_amt = 0.9;
  if (variant > 0.5 && variant < 1.5) {
    slat = vec3f(0.28, 0.32, 0.40);
    glow = vec3f(0.55, 0.65, 0.85);
    cord = vec3f(0.20, 0.22, 0.26);
    glow_amt = 0.8;
  } else if (variant >= 1.5) {
    slat = vec3f(0.76, 0.72, 0.58);
    glow = vec3f(0.85, 0.76, 0.52);
    cord = vec3f(0.48, 0.44, 0.34);
    glow_amt = 0.45;
  }
  let rows = 13.0;
  let row = floor(uv.y * rows);
  var ry = fract(uv.y * rows);
  let bent = step(0.93, rand(vec2f(row, seed)));
  ry = fract(ry + bent * 0.22 * sin(uv.x * 3.0 + seed));
  let body = smoothstep(0.05, 0.30, ry) * (1.0 - smoothstep(0.55, 0.95, ry));
  var col = slat * (0.55 + body * 0.55);
  let leak = 1.0 - smoothstep(0.0, 0.09, min(ry, 1.0 - ry));
  col = mix(col, glow, leak * glow_amt);
  let dust = fbm(uv.x * 14.0 + seed, row * 0.7, 3.0) * 0.5 + 0.5;
  col = col + vec3f((dust - 0.5) * 0.07);
  let c1 = line_near(uv.x - 0.18, 0.012);
  let c2 = line_near(uv.x - 0.82, 0.012);
  col = mix(col, cord, max(c1, c2) * 0.85);
  col = mix(col, slat * 0.5, speckle(px, 2.0, seed, 0.975) * 0.5);
  col = col + glow * 0.10 * glow_amt * smoothstep(0.8, 0.2, uv.y);
  return sat3(col);
}
