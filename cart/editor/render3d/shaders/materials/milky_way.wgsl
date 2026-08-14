// @material milky_way
// @slug milky-way
// @name Milky Way
// @board gradients
// @variant-labels Summer Core, Winter Arm, Desert Clear
// @kind gradient
// @tags gradients, milkyway, stars, night
// @author fable-sky_space
fn milky_way(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.02, 0.03, 0.07);
  var bandCol = vec3f(0.72, 0.68, 0.62);
  var coreCol = vec3f(0.95, 0.80, 0.58);
  var dustAmt = 0.85;
  if (variant > 0.5 && variant < 1.5) {
    night = vec3f(0.02, 0.02, 0.06); bandCol = vec3f(0.55, 0.60, 0.72); coreCol = vec3f(0.70, 0.75, 0.88); dustAmt = 0.45;
  } else if (variant >= 1.5) {
    night = vec3f(0.03, 0.02, 0.05); bandCol = vec3f(0.78, 0.66, 0.72); coreCol = vec3f(0.98, 0.85, 0.65); dustAmt = 1.0;
  }
  let tilt = 0.55 + fract(seed * 0.11) * 0.25;
  let nrm = normalize(vec2f(-tilt, 1.0));
  let rel = uv - vec2f(0.5, 0.5);
  let bd = abs(dot(rel, nrm));
  let along = dot(rel, vec2f(nrm.y, -nrm.x));
  let band = smoothstep(0.34, 0.02, bd);
  var col = night + vec3f(0.02, 0.02, 0.05) * (fbm(uv.x * 2.0 + seed, uv.y * 2.0, 3.0) + 0.5);
  col = col + bandCol * band * 0.45 * (0.6 + (fbm(along * 4.0 + seed, bd * 8.0, 4.0) + 0.5) * 0.8);
  let bulge = exp(-(bd * bd * 30.0 + along * along * 4.0));
  col = col + coreCol * bulge * 0.8;
  let dust = smoothstep(0.45, 0.85, fbm(along * 5.0 - seed * 0.7, bd * 22.0 + seed, 5.0) + 0.5);
  col = mix(col, night * 0.7, dust * band * dustAmt);
  let starsFar = speckle(px, 1.0, seed, 0.955);
  let starsBand = speckle(px, 1.0, seed + 3.0, 0.930) * band;
  let starsBright = speckle(px, 1.8, seed + 8.0, 0.990);
  col = col + vec3f(0.45, 0.47, 0.55) * starsFar + vec3f(0.72, 0.70, 0.66) * starsBand + vec3f(0.95, 0.95, 0.99) * starsBright;
  return sat3(col);
}
