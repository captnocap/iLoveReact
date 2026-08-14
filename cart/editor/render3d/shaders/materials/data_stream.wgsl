// @material data_stream
// @slug data-stream
// @name Data Stream
// @board neon_surface
// @variant-labels Matrix Green, Ice White, Corrupted Red
// @kind gradient
// @tags neon_surface, data, glyphs, code
// @author fable-scifi_hull
fn data_stream(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.01, 0.03, 0.01);
  var glyph = vec3f(0.15, 0.85, 0.30);
  var head = vec3f(0.75, 1.00, 0.80);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.02, 0.03, 0.05);
    glyph = vec3f(0.55, 0.75, 0.90);
    head = vec3f(0.95, 0.98, 1.00);
  } else if (variant >= 1.5) {
    deep = vec3f(0.04, 0.01, 0.01);
    glyph = vec3f(0.90, 0.20, 0.15);
    head = vec3f(1.00, 0.75, 0.40);
  }
  let colsN = 14.0;
  let rowsN = 22.0;
  let cid = floor(uv.x * colsN);
  let cr = rand(vec2f(cid, seed));
  let heady = fract(cr * 7.0 + seed * 0.213);
  let trail = fract(heady - uv.y);
  let energy = pow(1.0 - trail, 3.0);
  let cell = vec2f(cid, floor(uv.y * rowsN));
  let sub = floor(fract(uv * vec2f(colsN, rowsN)) * 3.0);
  let bit = step(0.45, rand(cell + sub * 0.31 + vec2f(seed * 0.7, cr * 5.0)));
  let inset = rect_mask(fract(uv * vec2f(colsN, rowsN)), 0.12, 0.88, 0.10, 0.90, 0.05);
  var col = deep;
  let glyphm = bit * inset;
  col = mix(col, glyph * (0.25 + energy), glyphm * (0.3 + energy * 0.9));
  let headm = exp(-pow((uv.y - heady) * rowsN, 2.0) * 2.0);
  col = mix(col, head, glyphm * headm * 0.9);
  col = col + glyph * energy * 0.10;
  if (variant >= 1.5) {
    let tear = step(0.85, rand(vec2f(floor(uv.y * 30.0), seed * 3.3)));
    col = mix(col, glyph * 0.7, tear * 0.4);
  }
  let scan = sin(uv.y * 300.0 + seed * 4.0) * 0.5 + 0.5;
  col = col * (0.88 + scan * 0.12);
  let ghost = fbm(uv.x * 3.0, uv.y * 3.0 + seed, 3.0) * 0.5 + 0.5;
  col = col + glyph * ghost * 0.05;
  return sat3(col);
}
