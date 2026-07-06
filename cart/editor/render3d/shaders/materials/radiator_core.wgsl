// @material radiator_core
// @slug radiator-core
// @name Radiator Core
// @board metal_yard
// @variant-labels Fresh Core, Bent Fins, Bug Clogged
// @kind surface
// @tags metal_yard, radiator, fins, cooling
// @author fable-machine_yard
fn radiator_core(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var finTone = vec3f(0.48, 0.50, 0.52);
  var tubeTone = vec3f(0.30, 0.32, 0.34);
  var dentAmt = 0.2;
  var clogAmt = 0.1;
  if (variant > 0.5 && variant < 1.5) {
    finTone = vec3f(0.42, 0.43, 0.45);
    dentAmt = 0.9;
    clogAmt = 0.25;
  } else if (variant >= 1.5) {
    finTone = vec3f(0.38, 0.36, 0.32);
    tubeTone = vec3f(0.26, 0.24, 0.21);
    dentAmt = 0.5;
    clogAmt = 0.9;
  }
  let fx = fract(uv.x * 56.0 + fract(seed * 0.113));
  let fin = sin(fx * 3.14159);
  var col = mix(vec3f(0.07, 0.08, 0.09), finTone * (0.5 + 0.6 * fin), smoothstep(0.05, 0.35, fin));
  let dent1 = blotch(uv, vec2f(0.3 + rand(vec2f(seed, 1.0)) * 0.4, 0.35), 0.14, vec2f(1.2, 0.8), seed);
  let dent2 = blotch(uv, vec2f(0.25 + rand(vec2f(seed, 2.0)) * 0.5, 0.68), 0.11, vec2f(0.9, 1.1), seed + 4.0);
  let dents = max(dent1, dent2) * dentAmt;
  col = mix(col, finTone * 0.35, dents);
  col = mix(col, finTone * 0.75, dents * (fbm(uv.x * 40.0, uv.y * 40.0 + seed, 2.0) * 0.5 + 0.5) * 0.7);
  let ty = fract(uv.y * 6.0);
  let tube = 1.0 - smoothstep(0.06, 0.10, min(ty, 1.0 - ty));
  col = mix(col, tubeTone * (0.6 + 0.5 * sin(ty * 3.14159 * 2.0 + 1.57)), tube);
  let clog = smoothstep(0.5, 0.85, fbm(uv.x * 10.0 + seed * 0.7, uv.y * 10.0, 3.0) * 0.5 + 0.5) * clogAmt;
  col = mix(col, vec3f(0.24, 0.20, 0.13), clog * 0.7);
  let frameL = 1.0 - smoothstep(0.0, 0.05, uv.x);
  let frameR = smoothstep(0.95, 1.0, uv.x);
  col = mix(col, vec3f(0.20, 0.21, 0.23), max(frameL, frameR));
  col = col + vec3f(0.22, 0.22, 0.22) * speckle(px, 2.0, seed, 0.992) * 0.4;
  return sat3(col);
}
