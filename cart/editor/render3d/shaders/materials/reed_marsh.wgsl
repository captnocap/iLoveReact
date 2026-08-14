// @material reed_marsh
// @slug reed-marsh
// @name Reed Marsh
// @board environment
// @variant-labels Cattail Stand, Winter Rushes, Green Shallows
// @kind surface
// @tags environment, reeds, marsh
// @author fable-botanic
fn reed_marsh(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var murk_lo = vec3f(0.05, 0.09, 0.06);
  var murk_hi = vec3f(0.14, 0.20, 0.12);
  var reed_lo = vec3f(0.22, 0.30, 0.10);
  var reed_hi = vec3f(0.52, 0.56, 0.24);
  var head_c = vec3f(0.30, 0.17, 0.09);
  var head_amt = 1.0;
  if (variant > 0.5 && variant < 1.5) {
    murk_lo = vec3f(0.08, 0.09, 0.09);
    murk_hi = vec3f(0.18, 0.19, 0.17);
    reed_lo = vec3f(0.38, 0.32, 0.18);
    reed_hi = vec3f(0.68, 0.60, 0.38);
    head_c = vec3f(0.55, 0.48, 0.36);
    head_amt = 0.5;
  } else if (variant >= 1.5) {
    murk_lo = vec3f(0.04, 0.11, 0.09);
    murk_hi = vec3f(0.10, 0.24, 0.16);
    reed_lo = vec3f(0.14, 0.34, 0.12);
    reed_hi = vec3f(0.34, 0.58, 0.20);
    head_amt = 0.25;
  }
  let bog = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5;
  var col = mix(murk_lo, murk_hi, bog);
  let sheen = line_near(sin(uv.y * 30.0 + snoise(uv.x * 4.0 + seed, uv.y * 2.0) * 2.0), 0.14);
  col = col + vec3f(0.05, 0.07, 0.06) * sheen;
  let lean = snoise(uv.x * 1.5 + seed, 0.5) * 0.06;
  let xx = uv.x + lean * uv.y;
  let colid = floor(xx * 46.0 + seed);
  let keep = step(0.35, rand(vec2f(colid, seed)));
  let stalk = line_near(sin(xx * 46.0 * 6.28318 * 0.5), 0.22) * keep;
  let clumpm = smoothstep(0.30, 0.65, fbm(uv.x * 3.0 + seed * 1.7, 0.3, 3.0) * 0.5 + 0.5);
  let tone = mix(reed_lo, reed_hi, rand(vec2f(colid, seed + 2.0)));
  col = mix(col, tone, stalk * clumpm * 0.9);
  let heady = fract(rand(vec2f(colid, seed + 5.0)) * 0.5 + 0.15);
  let headm = stalk * clumpm * smoothstep(0.09, 0.03, abs(uv.y - heady)) * step(0.55, rand(vec2f(colid, seed + 7.0)));
  col = mix(col, head_c, headm * head_amt);
  let gnat = speckle(px, 2.0, seed + 3.0, 0.985);
  col = col + vec3f(0.10, 0.10, 0.08) * gnat;
  return sat3(col);
}
