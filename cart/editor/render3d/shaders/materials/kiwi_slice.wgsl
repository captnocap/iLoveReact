// @material kiwi_slice
// @slug kiwi-slice
// @name Kiwi Slice
// @board props
// @variant-labels Green Classic, Gold Sun, Cutting Board
// @kind composition
// @tags props, kiwi, fruit, slice
// @author fable-food
fn kiwi_slice(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var board = vec3f(0.85, 0.72, 0.52);
  var flesh = vec3f(0.55, 0.78, 0.22);
  var fleshDeep = vec3f(0.34, 0.58, 0.14);
  var core = vec3f(0.94, 0.94, 0.82);
  var fuzz = vec3f(0.42, 0.30, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    flesh = vec3f(0.90, 0.74, 0.24);
    fleshDeep = vec3f(0.74, 0.55, 0.12);
    core = vec3f(0.97, 0.94, 0.80);
    fuzz = vec3f(0.52, 0.38, 0.20);
  } else if (variant >= 1.5) {
    board = vec3f(0.60, 0.44, 0.28);
    flesh = vec3f(0.48, 0.72, 0.20);
    fleshDeep = vec3f(0.28, 0.52, 0.12);
  }
  let grain2 = fbm(uv.x * 3.0 + seed, uv.y * 12.0, 3.0) * 0.5 + 0.5;
  var col = board * (0.85 + grain2 * 0.3);
  let ctr = vec2f(0.5, 0.5);
  let rel = uv - ctr;
  let d = length(rel);
  let ang = atan2(rel.y, rel.x);
  let skinMask = 1.0 - smoothstep(0.44, 0.46, d);
  let fleshMask = 1.0 - smoothstep(0.415, 0.43, d);
  col = mix(col, fuzz, skinMask);
  let fuzzSpeck = speckle(px, 2.0, seed + 2.0, 0.9) * sat(skinMask - fleshMask);
  col = mix(col, fuzz * 1.5, fuzzSpeck);
  let ray = sin(ang * 36.0 + seed) * 0.5 + 0.5;
  var meat = mix(fleshDeep, flesh, smoothstep(0.1, 0.42, d) * 0.5 + ray * 0.3);
  meat = mix(meat, flesh * 1.2, smoothstep(0.4, 0.9, ray) * smoothstep(0.38, 0.18, d) * 0.4);
  col = mix(col, meat, fleshMask);
  let coreMask = 1.0 - smoothstep(0.10, 0.145, d * (1.0 + snoise(ang * 2.0 + seed, 3.0) * 0.15));
  col = mix(col, core, coreMask * fleshMask);
  let sector = floor((ang + 3.14159) / 6.28318 * 22.0);
  let sa = (sector + 0.5) / 22.0 * 6.28318 - 3.14159;
  let sr = 0.20 + rand(vec2f(sector, seed)) * 0.09;
  let spos = ctr + vec2f(cos(sa), sin(sa)) * sr;
  let pip = dot_mark(uv, spos, 0.012 + rand(vec2f(sector, seed + 3.0)) * 0.005);
  col = mix(col, vec3f(0.08, 0.06, 0.04), pip * fleshMask);
  return sat3(col);
}
