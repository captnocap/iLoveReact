// @material lightning_fork
// @slug lightning-fork
// @name Lightning Fork
// @board environment
// @variant-labels Violet Strike, White Crack, Heat Lightning
// @kind composition
// @tags environment, lightning, storm
// @author fable-water_weather
fn lightning_fork(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sky_deep = vec3f(0.03, 0.03, 0.09);
  var cloud_tone = vec3f(0.10, 0.09, 0.16);
  var bolt_core = vec3f(0.98, 0.96, 1.0);
  var bolt_glow = vec3f(0.55, 0.42, 0.90);
  if (variant > 0.5 && variant < 1.5) {
    sky_deep = vec3f(0.05, 0.06, 0.08);
    cloud_tone = vec3f(0.13, 0.14, 0.17);
    bolt_glow = vec3f(0.60, 0.70, 0.92);
  } else if (variant >= 1.5) {
    sky_deep = vec3f(0.08, 0.04, 0.10);
    cloud_tone = vec3f(0.22, 0.10, 0.16);
    bolt_core = vec3f(1.0, 0.88, 0.70);
    bolt_glow = vec3f(0.85, 0.46, 0.30);
  }
  let mur = fbm(uv.x * 3.0 + seed, uv.y * 3.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(sky_deep, cloud_tone, mur);
  let ceiling = smoothstep(0.30, 0.0, uv.y);
  col = mix(col, cloud_tone * 1.3, ceiling * mur);
  let jag = fbm(uv.y * 7.0 + seed, seed * 0.7, 4.0);
  let jag2 = snoise(uv.y * 21.0 - seed, seed) * 0.04;
  let path_x = 0.5 + jag * 0.45 + jag2;
  let dx = abs(uv.x - path_x);
  let bolt = smoothstep(0.012, 0.0, dx);
  let halo = exp(-dx * 14.0);
  let branch_on = step(0.35, uv.y);
  let bjag = fbm(uv.y * 9.0 - seed * 1.3, seed + 40.0, 3.0);
  let bpath = path_x + (uv.y - 0.35) * 0.55 + bjag * 0.18;
  let bdx = abs(uv.x - bpath);
  let branch = smoothstep(0.008, 0.0, bdx) * branch_on * step(uv.y, 0.8);
  let bhalo = exp(-bdx * 20.0) * branch_on * step(uv.y, 0.8);
  col = col + bolt_glow * (halo * 0.55 + bhalo * 0.3);
  col = mix(col, bolt_core, max(bolt, branch * 0.85));
  let strobe = smoothstep(0.6, 1.0, mur) * ceiling;
  col = col + bolt_glow * strobe * 0.35;
  col = col + bolt_core * speckle(px, 2.0, seed + 3.0, 0.995) * 0.5;
  return sat3(col);
}
