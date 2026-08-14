// @atom field_cells
// @name Cell Borders
// @kind field
// @tags voronoi, cells, mask
// @author lab
fn field_cells(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  let v = voronoi(uv.x * 8.0 + seed, uv.y * 8.0 - seed);
  return sat((v.y - v.x) * 2.2);
}
