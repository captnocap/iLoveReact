// @material tortoise_shell
// @slug tortoise-shell
// @name Tortoise Shell
// @board props
// @variant-labels Amber Dome, Aged Moss, Blonde Comb
// @kind surface
// @tags props, shell, amber
// @author fable-creature_skins
fn tortoise_shell(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var lightc = vec3f(0.82, 0.58, 0.24);
  var midc = vec3f(0.52, 0.30, 0.10);
  var darkc = vec3f(0.22, 0.11, 0.04);
  if (variant > 0.5 && variant < 1.5) {
    lightc = vec3f(0.62, 0.55, 0.28);
    midc = vec3f(0.36, 0.30, 0.12);
    darkc = vec3f(0.14, 0.13, 0.06);
  } else if (variant >= 1.5) {
    lightc = vec3f(0.92, 0.76, 0.44);
    midc = vec3f(0.70, 0.48, 0.20);
    darkc = vec3f(0.38, 0.22, 0.08);
  }
  let vc = voronoi(uv.x * 3.4 + seed * 0.29, uv.y * 3.4 - seed * 0.19);
  let seam = smoothstep(0.34, 0.44, vc.x);
  let ringsv = sin(vc.x * 34.0 + vc.y * 6.0 + seed) * 0.5 + 0.5;
  let cloud = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 4.0) * 0.5 + 0.5;
  let ctone = rand(vec2f(vc.y * 5.3, seed * 0.7));
  var col = mix(lightc, midc, sat(vc.x * 2.2 + ctone * 0.3));
  col = mix(col, darkc, smoothstep(0.55, 0.62, cloud) * 0.85);
  col = col - vec3f(0.10, 0.07, 0.03) * ringsv * 0.35;
  col = mix(col, darkc, seam * 0.9);
  let gloss = pow(sat(1.0 - vc.x * 2.4), 3.0);
  col = col + vec3f(0.22, 0.16, 0.08) * gloss * 0.6;
  col = col - vec3f(0.08, 0.06, 0.03) * speckle(px, 3.0, seed + 5.0, 0.93);
  return sat3(col);
}
