// @material black_hole
// @slug black-hole
// @name Black Hole
// @board gradients
// @variant-labels Gargantua Amber, Blue Quasar, Dying Ember
// @kind composition
// @tags gradients, blackhole, accretion, space
// @author fable-sky_space
fn black_hole(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.01, 0.01, 0.04);
  var diskHot = vec3f(0.99, 0.85, 0.55);
  var diskCool = vec3f(0.80, 0.35, 0.12);
  var photonCol = vec3f(0.99, 0.95, 0.85);
  if (variant > 0.5 && variant < 1.5) {
    diskHot = vec3f(0.75, 0.88, 0.99); diskCool = vec3f(0.25, 0.40, 0.90); photonCol = vec3f(0.90, 0.96, 0.99);
  } else if (variant >= 1.5) {
    diskHot = vec3f(0.85, 0.40, 0.25); diskCool = vec3f(0.40, 0.12, 0.10); photonCol = vec3f(0.95, 0.60, 0.40);
  }
  let ctr = vec2f(0.5, 0.5);
  let d = uv - ctr;
  let holeR = 0.13;
  var col = night + vec3f(0.02, 0.02, 0.04) * (fbm(uv.x * 3.0 + seed, uv.y * 3.0, 3.0) + 0.5);
  col = col + vec3f(0.70, 0.72, 0.80) * speckle(px, 1.0, seed, 0.975) * smoothstep(holeR, holeR * 2.2, length(d));
  let q = vec2f(d.x, d.y * 3.2);
  let qr = length(q);
  let ang = atan2(q.y, q.x);
  let swirl = fbm(ang * 1.5 + qr * 9.0 - seed, qr * 5.0 + seed, 4.0) + 0.5;
  let diskBand = smoothstep(0.14, 0.19, qr) * smoothstep(0.46, 0.24, qr);
  let doppler = sat(0.55 - d.x * 2.4);
  let heat = smoothstep(0.42, 0.16, qr);
  var diskCol = mix(diskCool, diskHot, heat) * (0.35 + swirl * 1.1) * (0.4 + doppler * 1.2);
  col = col + diskCol * diskBand * step(0.0, d.y * d.y + 1.0);
  let photon = smoothstep(0.014, 0.003, abs(length(d) - holeR - 0.012));
  col = col + photonCol * photon * 1.3;
  let lensArc = smoothstep(0.020, 0.005, abs(length(d) - holeR - 0.045)) * smoothstep(0.1, 0.4, abs(d.y) / (abs(d.x) + 0.001));
  col = col + diskHot * lensArc * 0.8;
  col = mix(col, vec3f(0.005, 0.005, 0.01), smoothstep(holeR + 0.004, holeR - 0.008, length(d)));
  return sat3(col);
}
