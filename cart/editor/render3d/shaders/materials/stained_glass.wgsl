// @material stained_glass
// @slug stained-glass
// @name Stained Glass
// @board liminal
// @variant-labels Warm Cathedral, Cool Chapel, Sunset Rose
// @kind surface
// @tags liminal, stained, glass
// @author legacy
fn stained_glass(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Leaded glass window with irregular came, coloured panes, and transmitted light.
  let cell_uv = uv * 5.0;
  let cell = floor(cell_uv);
  let local = fract(cell_uv);
  // Irregular lead came — hand-drawn wobble.
  let warp = fbm(uv.x * 3.0 + seed, uv.y * 3.0 - seed, 3.0) * 0.06;
  let came_x = 1.0 - smoothstep(0.035 + warp, 0.065 + warp, min(local.x, 1.0 - local.x));
  let came_y = 1.0 - smoothstep(0.035 + warp, 0.065 + warp, min(local.y, 1.0 - local.y));
  let came = sat(came_x + came_y);
  // Cell palette — three-colour rotation per variant.
  let cell_rand = rand(cell + vec2f(seed, seed * 2.0));
  var p0 = vec3f(0.72, 0.10, 0.16);
  var p1 = vec3f(0.08, 0.42, 0.68);
  var p2 = vec3f(0.85, 0.68, 0.10);
  if (variant > 0.5 && variant < 1.5) {
    p0 = vec3f(0.10, 0.58, 0.34);
    p1 = vec3f(0.68, 0.16, 0.50);
    p2 = vec3f(0.14, 0.22, 0.62);
  } else if (variant >= 1.5) {
    p0 = vec3f(0.78, 0.38, 0.10);
    p1 = vec3f(0.10, 0.52, 0.56);
    p2 = vec3f(0.88, 0.84, 0.72);
  }
  var pane = p0;
  if (cell_rand > 0.66) { pane = p2; }
  else if (cell_rand > 0.33) { pane = p1; }
  // Transmitted light — backlit intensity varies across pane.
  let light = smoothstep(0.25, 0.85, fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5);
  pane = pane * (0.50 + light * 0.50);
  // Slight handmade glass texture (ripples).
  let tex = fbm(uv.x * 28.0 + seed, uv.y * 28.0, 4.0) * 0.5 + 0.5;
  pane = pane + vec3f((tex - 0.5) * 0.05);
  var col = mix(pane, vec3f(0.07, 0.07, 0.08), came);
  // Lead bloom — light catches the raised came edges.
  col = col + vec3f(0.35, 0.35, 0.28) * came * light * 0.14;
  return sat3(col);
}
