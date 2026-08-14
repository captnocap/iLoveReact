// @material plywood_sheet
// @slug plywood-sheet
// @name Plywood Sheet
// @board wood_brick_stone
// @variant-labels Fresh OSB, Boarded Window, Painted Scrap
// @kind surface
// @tags wood_brick_stone, plywood, sheet
// @author legacy
fn plywood_sheet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = wood(uv, px, select(0.0, 2.0, variant < 0.5), seed);
  let sheet = max(line_near(uv.x - 0.5, 0.006), line_near(uv.y - 0.5, 0.006));
  col = mix(col, vec3f(0.18, 0.12, 0.07), sheet * 0.45);
  if (variant > 0.5 && variant < 1.5) {
    let planks = (1.0 - smoothstep(0.010, 0.025, abs(fract(uv.y * 5.0) - 0.5)));
    col = mix(col, vec3f(0.10, 0.08, 0.055), planks * 0.55);
    col = mix(col, vec3f(0.05, 0.05, 0.05), speckle(px, 8.0, seed, 0.94) * 0.5);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.44, 0.20, 0.12), 0.42);
    col = mix(col, vec3f(0.94, 0.90, 0.78), crack_field(uv, seed, 9.0) * 0.35);
  }
  return sat3(col);
}
