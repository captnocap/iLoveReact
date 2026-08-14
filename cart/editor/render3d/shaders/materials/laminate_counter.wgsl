// @material laminate_counter
// @slug laminate-counter
// @name Laminate Counter
// @board liminal
// @variant-labels Gold Boomerang, Diner Turquoise, Avocado Kitchen
// @kind surface
// @tags liminal, counter, retro, kitchen
// @author fable-interior_home
fn laminate_counter(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.92, 0.87, 0.72);
  var boom_a = vec3f(0.85, 0.62, 0.18);
  var boom_b = vec3f(0.62, 0.48, 0.34);
  if (variant > 0.5 && variant < 1.5) {
    bg = vec3f(0.90, 0.93, 0.92);
    boom_a = vec3f(0.16, 0.55, 0.55);
    boom_b = vec3f(0.55, 0.75, 0.72);
  } else if (variant >= 1.5) {
    bg = vec3f(0.80, 0.80, 0.58);
    boom_a = vec3f(0.42, 0.48, 0.20);
    boom_b = vec3f(0.88, 0.78, 0.50);
  }
  let cell = floor(uv * 5.0);
  var lc = fract(uv * 5.0);
  let jr = rand(cell + vec2f(seed * 0.017, seed * 0.031));
  if (jr > 0.5) { lc.x = 1.0 - lc.x; }
  let jy = (rand(cell * 1.7 + vec2f(seed, 3.0)) - 0.5) * 0.2;
  let apex = vec2f(0.50, 0.34 + jy);
  let m1 = segment_mark(lc, vec2f(0.24, 0.66 + jy), apex, 0.045);
  let m2 = segment_mark(lc, apex, vec2f(0.78, 0.62 + jy), 0.045);
  let bmask = max(m1, m2);
  let pick = step(0.5, rand(cell + vec2f(7.0, seed)));
  let mote = fbm(uv.x * 30.0 + seed, uv.y * 30.0, 3.0) * 0.5 + 0.5;
  var col = bg + vec3f((mote - 0.5) * 0.06);
  col = mix(col, mix(boom_a, boom_b, pick), bmask * 0.9);
  let burn = blotch(uv, vec2f(0.30 + fract(seed * 0.13) * 0.4, 0.55), 0.07, vec2f(1.0, 0.7), seed);
  col = mix(col, vec3f(0.30, 0.20, 0.12), burn * 0.8);
  col = mix(col, vec3f(0.16, 0.11, 0.07), blotch(uv, vec2f(0.68, 0.30), 0.03, vec2f(1.0, 1.0), seed + 9.0) * 0.9);
  col = col + vec3f(0.06) * smoothstep(0.3, 0.0, uv.y);
  return sat3(col);
}
