// @material supernova_shell
// @slug supernova-shell
// @name Supernova Shell
// @board gradients
// @variant-labels Fresh Blast, Twin Shell, Cold Remnant
// @kind composition
// @tags gradients, supernova, rings, space
// @author fable-sky_space
fn supernova_shell(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.02, 0.02, 0.06);
  var shellCol = vec3f(0.95, 0.55, 0.25);
  var outerCol = vec3f(0.30, 0.70, 0.75);
  var coreCol = vec3f(0.98, 0.94, 0.85);
  var r1 = 0.24;
  var twin = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    shellCol = vec3f(0.85, 0.35, 0.55); outerCol = vec3f(0.40, 0.55, 0.95); r1 = 0.20; twin = 1.0;
  } else if (variant >= 1.5) {
    night = vec3f(0.03, 0.02, 0.05); shellCol = vec3f(0.45, 0.30, 0.55); outerCol = vec3f(0.25, 0.40, 0.50); coreCol = vec3f(0.55, 0.58, 0.68); r1 = 0.32;
  }
  let ctr = vec2f(0.5, 0.5);
  let d = uv - ctr;
  let ang = atan2(d.y, d.x);
  let warp = fbm(cos(ang) * 3.0 + seed, sin(ang) * 3.0 - seed * 0.5, 4.0);
  let r = length(d) * (1.0 + warp * 0.28);
  var col = night + vec3f(0.02, 0.02, 0.04) * (fbm(uv.x * 3.5 + seed, uv.y * 3.5, 3.0) + 0.5);
  let ring1 = smoothstep(0.05, 0.008, abs(r - r1));
  col = col + shellCol * ring1 * (0.6 + (fbm(ang * 2.0 + seed, r * 10.0, 4.0) + 0.5) * 0.8);
  let ring2 = smoothstep(0.07, 0.012, abs(r - r1 - 0.13));
  col = col + outerCol * ring2 * 0.55;
  let ring3 = smoothstep(0.03, 0.006, abs(r - r1 * 0.55)) * twin;
  col = col + coreCol * ring3 * 0.7;
  let fil = smoothstep(0.55, 0.9, fbm(ang * 4.0 - seed, r * 14.0 + seed, 5.0) + 0.5);
  col = col + shellCol * fil * smoothstep(r1 + 0.1, r1 - 0.1, r) * 0.4;
  col = col + coreCol * (exp(-r * r * 300.0) * 1.4 + dot_mark(uv, ctr, 0.008));
  col = col + vec3f(0.85, 0.88, 0.95) * speckle(px, 1.1, seed, 0.978);
  return sat3(col);
}
