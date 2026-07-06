// @material slate_hearth
// @slug slate-hearth
// @name Slate Hearth
// @board liminal
// @variant-labels Ember Glow, Cold Ash, Swept Clean
// @kind surface
// @tags liminal, hearth, stone, fireplace
// @author fable-interior_home
fn slate_hearth(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var slate_lo = vec3f(0.16, 0.18, 0.22);
  var slate_hi = vec3f(0.34, 0.37, 0.42);
  var ash = vec3f(0.72, 0.70, 0.66);
  var ember = vec3f(0.95, 0.45, 0.10);
  var ash_amt = 0.4;
  var ember_amt = 1.0;
  if (variant > 0.5 && variant < 1.5) {
    slate_lo = vec3f(0.14, 0.15, 0.17);
    slate_hi = vec3f(0.30, 0.31, 0.34);
    ash = vec3f(0.62, 0.60, 0.57);
    ember = vec3f(0.30, 0.18, 0.12);
    ash_amt = 0.9;
    ember_amt = 0.2;
  } else if (variant >= 1.5) {
    slate_lo = vec3f(0.18, 0.21, 0.27);
    slate_hi = vec3f(0.40, 0.45, 0.52);
    ash = vec3f(0.68, 0.68, 0.66);
    ember = vec3f(0.80, 0.55, 0.25);
    ash_amt = 0.1;
    ember_amt = 0.1;
  }
  let cell = floor(uv * vec2f(2.0, 3.0));
  let lc = fract(uv * vec2f(2.0, 3.0));
  let tone = rand(cell + vec2f(seed * 0.011, 4.0));
  let cleave = fbm(uv.x * 7.0 + tone * 5.0, uv.y * 30.0 + seed, 3.0) * 0.5 + 0.5;
  var col = mix(slate_lo, slate_hi, tone * 0.45 + cleave * 0.55);
  let near_e = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  col = mix(col, slate_lo * 0.6, (1.0 - smoothstep(0.015, 0.04, near_e)) * 0.85);
  let dust = (fbm(uv.x * 5.0, uv.y * 5.0 + seed * 0.4, 3.0) * 0.5 + 0.5) * smoothstep(0.35, 0.9, uv.y);
  col = mix(col, ash, dust * ash_amt);
  let em = speckle(px, 3.0, seed + 7.0, 0.982) * smoothstep(0.5, 1.0, uv.y);
  col = mix(col, ember, em * ember_amt);
  col = col + ember * 0.12 * ember_amt * smoothstep(0.5, 1.0, uv.y) * (fbm(uv.x * 3.0, seed, 3.0) * 0.5 + 0.5);
  return sat3(col);
}
