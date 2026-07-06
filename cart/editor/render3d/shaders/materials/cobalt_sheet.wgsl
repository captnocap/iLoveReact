// @material cobalt_sheet
// @slug cobalt-sheet
// @name Cobalt Sheet
// @board wall_props
// @variant-labels Silver Sheet, Blue Sheet, Oxidized Sheet
// @kind surface
// @tags wall_props, cobalt, sheet, plate
// @author editor
fn cobalt_sheet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var steel = vec3f(0.22, 0.23, 0.24);
  var blue = vec3f(0.26, 0.73, 0.97);
  var old = vec3f(0.39, 0.27, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    steel = vec3f(0.16, 0.17, 0.20);
    blue = vec3f(0.37, 0.87, 1.00);
    old = vec3f(0.60, 0.40, 0.20);
  } else if (variant >= 1.5) {
    steel = vec3f(0.30, 0.31, 0.33);
    blue = vec3f(0.58, 0.54, 0.95);
    old = vec3f(0.74, 0.22, 0.09);
  }
  let p = 1.0 - smoothstep(0.12, 0.17, abs(fract((uv.x + uv.y * 0.95) * 30.0 + seed * 0.9) - 0.5));
  let rust = crack_field(uv, seed + 4.0, 15.0);
  var col = mix(steel, blue, smoothstep(0.35, 0.80, fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5));
  col = mix(col, old, (p * 0.35) + (rust * 0.45));
  col = col + vec3f(0.04, 0.04, 0.04) * speckle(px, 2.0, seed + 7.0, 0.978);
  col = col - vec3f(0.05, 0.05, 0.05) * speckle(px, 1.6, seed + 13.0, 0.935);
  return sat3(col);
}
