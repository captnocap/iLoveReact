// @material cargo_container
// @slug cargo-container
// @name Cargo Container
// @board metal_yard
// @variant-labels Harbor Blue, Line Red, Jungle Green
// @kind composition
// @tags metal_yard, container, corrugated, rust
// @author fable-machine_yard
fn cargo_container(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var paintTone = vec3f(0.16, 0.32, 0.52);
  var logoTone = vec3f(0.90, 0.88, 0.84);
  var rustAmt = 0.45;
  if (variant > 0.5 && variant < 1.5) {
    paintTone = vec3f(0.55, 0.16, 0.12);
    logoTone = vec3f(0.92, 0.90, 0.86);
    rustAmt = 0.65;
  } else if (variant >= 1.5) {
    paintTone = vec3f(0.22, 0.38, 0.24);
    logoTone = vec3f(0.85, 0.75, 0.25);
    rustAmt = 0.30;
  }
  let wave = sin(uv.x * 3.14159 * 14.0) * 0.5 + 0.5;
  var col = paintTone * (0.55 + 0.55 * wave);
  let fade = fbm(uv.x * 4.0 + seed * 0.21, uv.y * 4.0, 3.0) * 0.5 + 0.5;
  col = mix(col, paintTone * 1.25, fade * 0.3);
  let logo = rect_mask(uv, 0.30, 0.70, 0.28, 0.44, 0.01);
  col = mix(col, logoTone, logo * 0.8);
  let bar = rect_mask(uv, 0.30, 0.58, 0.50, 0.53, 0.008);
  col = mix(col, logoTone, bar * 0.6);
  let bar2 = rect_mask(uv, 0.30, 0.48, 0.56, 0.585, 0.008);
  col = mix(col, logoTone, bar2 * 0.5);
  let drips = vertical_drips(uv, seed, 0.7);
  col = mix(col, vec3f(0.44, 0.23, 0.12), drips * rustAmt);
  let corr = blotch(uv, vec2f(0.15 + rand(vec2f(seed, 1.0)) * 0.7, 0.85), 0.20, vec2f(1.4, 0.6), seed + 3.0);
  col = mix(col, vec3f(0.36, 0.19, 0.10), corr * rustAmt * 1.2);
  col = mix(col, vec3f(0.10, 0.09, 0.08), smoothstep(0.92, 1.0, uv.y) * 0.6);
  col = mix(col, vec3f(0.10, 0.09, 0.08), (1.0 - smoothstep(0.0, 0.06, uv.y)) * 0.5);
  col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed, 0.992) * 0.4;
  return sat3(col);
}
