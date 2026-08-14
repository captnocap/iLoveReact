// @material croc_hide
// @slug croc-hide
// @name Croc Hide
// @board props
// @variant-labels Swamp Back, Belly Plates, Black Caiman
// @kind surface
// @tags props, scales, leather
// @author fable-creature_skins
fn croc_hide(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var platec = vec3f(0.36, 0.40, 0.22);
  var crev = vec3f(0.10, 0.11, 0.06);
  var shine = vec3f(0.62, 0.66, 0.42);
  var sx = 6.0;
  var sy = 5.0;
  if (variant > 0.5 && variant < 1.5) {
    platec = vec3f(0.78, 0.68, 0.48);
    crev = vec3f(0.42, 0.33, 0.20);
    shine = vec3f(0.92, 0.85, 0.66);
    sx = 4.0;
    sy = 7.0;
  } else if (variant >= 1.5) {
    platec = vec3f(0.16, 0.16, 0.15);
    crev = vec3f(0.04, 0.05, 0.04);
    shine = vec3f(0.38, 0.40, 0.36);
    sx = 7.0;
    sy = 6.0;
  }
  let p = vec2f(uv.x * sx + seed * 0.17, uv.y * sy - seed * 0.09);
  let cell = floor(p);
  let f = fract(p);
  let tone = rand(cell + seed);
  let plate = rect_mask(f, 0.05, 0.95, 0.08, 0.92, 0.07);
  let dome = 1.0 - sat(length((f - vec2f(0.5, 0.5)) * vec2f(1.3, 1.5)));
  let bump = 1.0 - smoothstep(0.0, 0.30, length(f - vec2f(0.5, 0.38)));
  let pores = fbm(p.x * 7.0 + seed, p.y * 7.0, 3.0) * 0.5 + 0.5;
  var col = mix(crev, platec * (0.82 + tone * 0.35), plate);
  col = col + shine * dome * plate * 0.28;
  col = col + shine * bump * plate * 0.30;
  col = col - vec3f(0.08, 0.08, 0.05) * pores * plate * 0.5;
  col = col - vec3f(0.10, 0.09, 0.06) * speckle(px, 3.0, seed + 7.0, 0.94);
  return sat3(col);
}
