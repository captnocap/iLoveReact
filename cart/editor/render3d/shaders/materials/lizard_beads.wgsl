// @material lizard_beads
// @slug lizard-beads
// @name Lizard Beads
// @board props
// @variant-labels Gila Orange, Ember Pink, Bone Banded
// @kind surface
// @tags props, scales, beaded
// @author fable-creature_skins
fn lizard_beads(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var warmc = vec3f(0.90, 0.42, 0.10);
  var darkc = vec3f(0.11, 0.08, 0.09);
  var gapc = vec3f(0.05, 0.04, 0.04);
  if (variant > 0.5 && variant < 1.5) {
    warmc = vec3f(0.92, 0.48, 0.44);
    darkc = vec3f(0.16, 0.10, 0.13);
    gapc = vec3f(0.07, 0.04, 0.06);
  } else if (variant >= 1.5) {
    warmc = vec3f(0.88, 0.82, 0.66);
    darkc = vec3f(0.20, 0.14, 0.10);
    gapc = vec3f(0.09, 0.06, 0.04);
  }
  var region = fbm(uv.x * 3.0 + seed, uv.y * 3.0 - seed * 0.6, 3.0) * 0.5 + 0.5;
  if (variant >= 1.5) {
    region = smoothstep(-0.4, 0.4, sin(uv.x * 9.0 + snoise(uv.y * 3.0 + seed, uv.x * 2.0) * 1.2));
  }
  let hot = smoothstep(0.46, 0.55, region);
  let vc = voronoi(uv.x * 26.0 + seed * 0.4, uv.y * 26.0 - seed * 0.3);
  let bead = 1.0 - smoothstep(0.30, 0.50, vc.x);
  let glint = 1.0 - smoothstep(0.0, 0.20, vc.x);
  let btone = rand(vec2f(vc.y * 3.7, vc.y + seed));
  var bc = mix(darkc, warmc, hot) * (0.80 + btone * 0.40);
  var col = mix(gapc, bc, bead);
  col = col + vec3f(0.30, 0.24, 0.18) * glint * bead * 0.55;
  col = col - vec3f(0.05, 0.04, 0.04) * (fbm(uv.x * 1.6, uv.y * 1.6 + seed, 3.0) * 0.5 + 0.5) * 0.5;
  return sat3(col);
}
