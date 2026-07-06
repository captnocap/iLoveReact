// @material slush_gray
// @slug slush-gray
// @name Slush Gray
// @board environment
// @variant-labels Curb Sludge, Rut Runnel, Freeze Refreeze
// @kind surface
// @tags environment, slush, street
// @author fable-water_weather
fn slush_gray(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var slush_lit = vec3f(0.66, 0.66, 0.68);
  var slush_dark = vec3f(0.30, 0.30, 0.32);
  var melt = vec3f(0.14, 0.15, 0.18);
  var grime_tone = vec3f(0.24, 0.20, 0.16);
  var rut_a = 0.32;
  var rut_b = 0.68;
  if (variant > 0.5 && variant < 1.5) {
    slush_lit = vec3f(0.58, 0.58, 0.60);
    slush_dark = vec3f(0.24, 0.25, 0.27);
    melt = vec3f(0.10, 0.11, 0.14);
    rut_a = 0.40;
    rut_b = 0.62;
  } else if (variant >= 1.5) {
    slush_lit = vec3f(0.74, 0.76, 0.80);
    slush_dark = vec3f(0.40, 0.42, 0.48);
    melt = vec3f(0.20, 0.24, 0.32);
    grime_tone = vec3f(0.30, 0.28, 0.24);
    rut_a = 0.25;
    rut_b = 0.78;
  }
  let mush = fbm(uv.x * 8.0 + seed, uv.y * 8.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(slush_dark, slush_lit, mush);
  let chunk = voronoi(uv.x * 12.0 - seed, uv.y * 12.0 + seed);
  col = mix(col, slush_lit * 1.1, smoothstep(0.12, 0.04, chunk.x) * step(0.6, rand(vec2f(chunk.y, seed))) * 0.7);
  let wobble = snoise(uv.y * 4.0 + seed, seed) * 0.04;
  let da = abs(uv.x - rut_a + wobble);
  let db = abs(uv.x - rut_b - wobble);
  let rut = max(smoothstep(0.09, 0.02, da), smoothstep(0.09, 0.02, db));
  col = mix(col, melt, rut * 0.85);
  let sheen = line_near(sin(uv.y * 30.0 + seed) * 0.8, 0.20) * rut;
  col = mix(col, slush_lit * 0.9 + vec3f(0.02, 0.03, 0.06), sheen * 0.5);
  let spatter = speckle(px, 2.4, seed + 4.0, 0.90);
  col = mix(col, grime_tone, spatter * 0.55);
  col = mix(col, grime_tone * 0.7, smoothstep(0.5, 0.9, fbm(uv.x * 3.0 - seed, uv.y * 3.0, 3.0) * 0.5 + 0.5) * 0.25);
  return sat3(col);
}
