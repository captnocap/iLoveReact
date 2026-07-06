// @material pulsar_beams
// @slug pulsar-beams
// @name Pulsar Beams
// @board gradients
// @variant-labels Lighthouse Blue, Magnetar Violet, X-Ray White
// @kind composition
// @tags gradients, pulsar, beams, space
// @author fable-sky_space
fn pulsar_beams(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.01, 0.02, 0.05);
  var beamCol = vec3f(0.45, 0.75, 0.99);
  var ringCol = vec3f(0.25, 0.45, 0.80);
  var coreCol = vec3f(0.92, 0.96, 0.99);
  if (variant > 0.5 && variant < 1.5) {
    night = vec3f(0.03, 0.01, 0.05); beamCol = vec3f(0.75, 0.40, 0.95); ringCol = vec3f(0.55, 0.22, 0.70); coreCol = vec3f(0.98, 0.88, 0.99);
  } else if (variant >= 1.5) {
    night = vec3f(0.02, 0.02, 0.04); beamCol = vec3f(0.90, 0.92, 0.85); ringCol = vec3f(0.55, 0.60, 0.58); coreCol = vec3f(0.99, 0.99, 0.92);
  }
  let ctr = vec2f(0.5, 0.5);
  let d = uv - ctr;
  let r = length(d) + 0.0005;
  let baseAng = fract(seed * 0.083) * 3.14;
  let ang = atan2(d.y, d.x) - baseAng;
  var col = night + vec3f(0.02, 0.02, 0.05) * (fbm(uv.x * 3.0 + seed, uv.y * 3.0, 3.0) + 0.5);
  let beamA = pow(abs(cos(ang)), 60.0);
  let beamB = pow(abs(cos(ang + 1.5708)), 60.0) * 0.6;
  let reach = exp(-r * 2.0);
  col = col + beamCol * (beamA + beamB) * reach * 1.3;
  let flick = fbm(r * 20.0 + seed, ang * 2.0, 3.0) + 0.5;
  col = col + beamCol * (beamA + beamB) * reach * flick * 0.5;
  let ringWave = sin(r * 55.0 - seed * 2.0);
  let rings = smoothstep(0.55, 0.95, ringWave) * exp(-r * 4.5);
  col = col + ringCol * rings * 0.8;
  col = col + coreCol * (exp(-r * r * 900.0) * 1.8 + exp(-r * 14.0) * 0.35);
  col = col + vec3f(0.75, 0.78, 0.88) * speckle(px, 1.0, seed, 0.976);
  col = col + vec3f(0.92, 0.94, 0.99) * speckle(px, 1.8, seed + 7.0, 0.992);
  return sat3(col);
}
