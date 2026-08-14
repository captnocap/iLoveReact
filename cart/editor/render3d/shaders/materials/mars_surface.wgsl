// @material mars_surface
// @slug mars-surface
// @name Mars Surface
// @board gradients
// @variant-labels Dune Sea, Rock Plain, Dust Storm
// @kind surface
// @tags gradients, mars, regolith, dunes
// @author fable-sky_space
fn mars_surface(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lo = vec3f(0.45, 0.20, 0.11);
  var hi = vec3f(0.72, 0.38, 0.20);
  var duneAmt = 0.8;
  var rockAmt = 0.3;
  var hazeAmt = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.38, 0.18, 0.12); hi = vec3f(0.62, 0.34, 0.22); duneAmt = 0.25; rockAmt = 1.0; hazeAmt = 0.0;
  } else if (variant >= 1.5) {
    lo = vec3f(0.55, 0.30, 0.17); hi = vec3f(0.82, 0.52, 0.30); duneAmt = 0.4; rockAmt = 0.15; hazeAmt = 0.7;
  }
  let ground = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed * 0.6, 5.0) + 0.5;
  var col = mix(lo, hi, ground);
  let bend = fbm(uv.x * 2.0 + seed * 0.4, uv.y * 2.0, 3.0);
  let duneWave = sin((uv.y + bend * 0.35) * 34.0 + seed);
  let duneShade = smoothstep(-0.7, 0.7, duneWave);
  col = mix(col, lo * 0.85, (1.0 - duneShade) * 0.45 * duneAmt);
  col = mix(col, hi * 1.10, pow(duneShade, 3.0) * 0.35 * duneAmt);
  let cell = voronoi(uv.x * 12.0 + seed, uv.y * 12.0);
  let boulder = smoothstep(0.14, 0.03, cell.x) * step(0.55, fract(cell.y * 7.13 + seed * 0.1));
  col = mix(col, vec3f(0.30, 0.16, 0.11), boulder * rockAmt);
  col = col + vec3f(0.30, 0.14, 0.06) * speckle(px, 1.6, seed, 0.94) * rockAmt * 0.6;
  let haze = fbm(uv.x * 3.0 - seed, uv.y * 3.0 + seed, 4.0) + 0.5;
  col = mix(col, vec3f(0.88, 0.62, 0.38), smoothstep(0.45, 0.95, haze) * hazeAmt * 0.5);
  return sat3(col);
}
