// @material packed_snow
// @slug packed-snow
// @name Packed Snow
// @board environment
// @variant-labels Trail Tramp, City Gray, Blue Evening
// @kind surface
// @tags environment, snow, packed
// @author fable-water_weather
fn packed_snow(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var crust_lit = vec3f(0.88, 0.90, 0.94);
  var pit_tone = vec3f(0.56, 0.64, 0.80);
  var grit = vec3f(0.36, 0.32, 0.28);
  var grit_amt = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    crust_lit = vec3f(0.78, 0.79, 0.80);
    pit_tone = vec3f(0.52, 0.54, 0.58);
    grit = vec3f(0.24, 0.22, 0.20);
    grit_amt = 0.75;
  } else if (variant >= 1.5) {
    crust_lit = vec3f(0.72, 0.78, 0.92);
    pit_tone = vec3f(0.38, 0.46, 0.70);
    grit = vec3f(0.28, 0.30, 0.40);
    grit_amt = 0.15;
  }
  let lump = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(pit_tone, crust_lit, lump);
  let vor = voronoi(uv.x * 7.0 + seed, uv.y * 9.0 - seed * 0.5);
  let print_mask = smoothstep(0.30, 0.12, vor.x) * step(0.45, rand(vec2f(vor.y, seed)));
  col = mix(col, pit_tone * 0.85, print_mask * 0.7);
  let tread = line_near(sin(uv.y * 70.0 + rand(vec2f(vor.y, seed + 1.0)) * 20.0), 0.25) * print_mask;
  col = mix(col, pit_tone * 0.65, tread * 0.6);
  let rim = smoothstep(0.34, 0.28, vor.x) * (1.0 - smoothstep(0.28, 0.16, vor.x)) * step(0.45, rand(vec2f(vor.y, seed)));
  col = mix(col, crust_lit * 1.05, rim * 0.8);
  let dirt = speckle(px, 2.2, seed + 3.0, 1.0 - 0.05 * grit_amt);
  col = mix(col, grit, dirt * grit_amt);
  let sparkle = speckle(px, 1.6, seed + 8.0, 0.98);
  col = mix(col, vec3f(1.0, 1.0, 0.98), sparkle * (1.0 - print_mask) * 0.8);
  return sat3(col);
}
