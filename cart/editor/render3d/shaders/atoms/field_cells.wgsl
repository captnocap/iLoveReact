// @atom field_cells
// @name Cell Borders
// @kind field
// @tags voronoi, cells, mask
// @author lab
// @param scale: f32 = 8.0 range(2.0, 24.0) "Cell scale"
fn field_cells(uv: vec2f, px: vec2f, seed: f32) -> f32 {
  let v = voronoi(uv.x * scale + seed, uv.y * scale - seed);
  return sat((v.y - v.x) * 2.2);
}
