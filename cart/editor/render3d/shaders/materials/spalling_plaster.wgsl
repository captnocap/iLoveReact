// @material spalling_plaster
// @slug spalling-plaster
// @name Spalling Plaster
// @board condemned
// @variant-labels First Lift, Wet Edge, Powder Flake
// @kind surface
// @tags condemned, plaster, peel
// @author editor
fn spalling_plaster(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.62, 0.58, 0.52);
  var chip = vec3f(0.95, 0.89, 0.82);
  var stain = vec3f(0.40, 0.32, 0.25);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.48, 0.43, 0.38);
    chip = vec3f(0.76, 0.69, 0.60);
    stain = vec3f(0.35, 0.27, 0.21);
  } else if (variant >= 1.5) {
    base = vec3f(0.82, 0.78, 0.72);
    chip = vec3f(0.60, 0.53, 0.45);
    stain = vec3f(0.30, 0.20, 0.14);
  }
  let warp = fbm(uv.x * 4.1 + seed, uv.y * 4.1 - seed, 3.0) * 0.5 + 0.5;
  let ch = crack_field(uv + vec2f(seed * 0.1, 0.0), seed + 8.0, 11.0);
  var col = mix(base, chip, smoothstep(0.56, 0.72, warp));
  col = mix(col, stain, ch * 0.55);
  let flakes = step(0.94, rand(floor((uv + vec2f(seed * 0.3, seed * 0.17)) * 36.0)));
  col = mix(col, vec3f(0.98, 0.94, 0.88), flakes * 0.35);
  col = col - vec3f(0.12, 0.10, 0.08) * speckle(px, 2.6, seed + 1.0, 0.955);
  col = col + vec3f(0.02, 0.02, 0.02) * crack_field(uv * 1.3, seed + 10.0, 26.0);
  return sat3(col);
}

