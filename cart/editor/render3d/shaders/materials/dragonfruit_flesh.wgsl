// @material dragonfruit_flesh
// @slug dragonfruit-flesh
// @name Dragonfruit Flesh
// @board props
// @variant-labels White Classic, Red Heart, Magenta Rim
// @kind surface
// @tags props, dragonfruit, fruit, tropical
// @author fable-food
fn dragonfruit_flesh(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var flesh = vec3f(0.93, 0.92, 0.90);
  var fleshLo = vec3f(0.82, 0.80, 0.78);
  var rind = vec3f(0.90, 0.20, 0.48);
  var tip = vec3f(0.55, 0.80, 0.40);
  var rimW = 0.12;
  if (variant > 0.5 && variant < 1.5) {
    flesh = vec3f(0.78, 0.12, 0.36);
    fleshLo = vec3f(0.62, 0.08, 0.28);
    rind = vec3f(0.92, 0.28, 0.52);
    tip = vec3f(0.50, 0.76, 0.36);
  } else if (variant >= 1.5) {
    flesh = vec3f(0.95, 0.90, 0.92);
    fleshLo = vec3f(0.86, 0.76, 0.82);
    rind = vec3f(0.96, 0.16, 0.56);
    rimW = 0.2;
  }
  let pulp = fbm(uv.x * 9.0 + seed, uv.y * 9.0, 3.0) * 0.5 + 0.5;
  var col = mix(fleshLo, flesh, pulp);
  let wet = snoise(uv.x * 5.0 + seed * 0.6, uv.y * 5.0) * 0.5 + 0.5;
  col = mix(col, flesh * 1.08, smoothstep(0.6, 0.85, wet) * 0.5);
  let pips = speckle(px, 3.0, seed + 5.0, 0.925);
  col = mix(col, vec3f(0.07, 0.06, 0.06), pips * 0.95);
  let pipShine = speckle(px + vec2f(1.0, 1.0), 3.0, seed + 5.0, 0.985);
  col = mix(col, vec3f(0.55, 0.52, 0.50), pipShine * 0.5);
  let edge = min(uv.x, 1.0 - uv.x);
  let rimMask = 1.0 - smoothstep(rimW * 0.6, rimW, edge + snoise(uv.y * 8.0 + seed, 2.0) * 0.02);
  col = mix(col, rind, rimMask * 0.95);
  let scaleWave = sin(uv.y * 26.0 + seed) * 0.5 + 0.5;
  let tipMask = rimMask * smoothstep(0.7, 0.95, scaleWave) * (1.0 - smoothstep(0.02, 0.06, edge));
  col = mix(col, tip, tipMask * 0.8);
  return sat3(col);
}
