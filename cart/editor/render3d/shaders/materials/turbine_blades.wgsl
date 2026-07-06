// @material turbine_blades
// @slug turbine-blades
// @name Turbine Blades
// @board metal_yard
// @variant-labels Polished Steel, Warning Tips, Old Bronze
// @kind composition
// @tags metal_yard, turbine, fan, radial
// @author fable-machine_yard
fn turbine_blades(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bladeTone = vec3f(0.60, 0.62, 0.66);
  var hubTone = vec3f(0.30, 0.31, 0.33);
  var tipTone = vec3f(0.60, 0.62, 0.66);
  var housingTone = vec3f(0.20, 0.21, 0.23);
  if (variant > 0.5 && variant < 1.5) {
    bladeTone = vec3f(0.30, 0.32, 0.36);
    tipTone = vec3f(0.90, 0.72, 0.12);
    hubTone = vec3f(0.14, 0.15, 0.17);
  } else if (variant >= 1.5) {
    bladeTone = vec3f(0.58, 0.44, 0.26);
    tipTone = vec3f(0.58, 0.44, 0.26);
    hubTone = vec3f(0.34, 0.25, 0.15);
    housingTone = vec3f(0.16, 0.13, 0.10);
  }
  let p = uv - vec2f(0.5, 0.5);
  let r = length(p);
  let ang = atan2(p.y, p.x) + seed * 0.7;
  let swirl = ang + r * 7.0;
  let bladeWave = sin(swirl * 9.0);
  let bmask = smoothstep(-0.15, 0.35, bladeWave);
  var col = mix(housingTone * 0.5, bladeTone * (0.45 + 0.75 * bmask), smoothstep(0.13, 0.16, r));
  col = col + vec3f(0.22, 0.22, 0.24) * pow(max(bladeWave, 0.0), 6.0) * smoothstep(0.13, 0.2, r) * 0.8;
  let tipBand = smoothstep(0.36, 0.39, r) * (1.0 - smoothstep(0.44, 0.46, r));
  col = mix(col, tipTone * (0.5 + 0.6 * bmask), tipBand * step(0.0, bladeWave));
  let hub = 1.0 - smoothstep(0.13, 0.15, r);
  col = mix(col, hubTone * (1.0 - r * 2.0 + 0.6), hub);
  let ba = fract(ang * 0.9549);
  let boltA = floor(ang * 0.9549 * 6.0);
  let bd = 1.0 - smoothstep(0.010, 0.016, abs(r - 0.09) + abs(sin(ang * 3.0)) * 0.03);
  col = mix(col, hubTone * 1.5, bd * hub);
  let ring = 1.0 - smoothstep(0.012, 0.028, abs(r - 0.47));
  col = mix(col, housingTone, max(ring, smoothstep(0.47, 0.50, r)));
  let dust = fbm(uv.x * 8.0 + seed, uv.y * 8.0, 3.0) * 0.5 + 0.5;
  col = col * (0.85 + 0.3 * dust);
  col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed, 0.992) * 0.4;
  return sat3(col);
}
