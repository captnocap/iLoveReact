// tileField.wgsl.ts — renders the painted tile map as ONE Effect quad.
//
// Per fragment: find the 1m cell, read its tile-kind index from the buffer, look
// the colour up in the palette (also in the buffer). Empty cells (-1) read as dark
// ground with a faint grid. Same scale story as the heightfield — 8x8 demo or a
// full chunk is the same shader. (WGSL: no unary +, no backticks in comments.)
//
// D[] layout (see encodeTileMap): [0]cols [1]rows [2]paletteCount, then
// paletteCount*3 palette rgb floats, then rows*cols cell indices.

export const TILE_FIELD_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let pal = i32(D[2]);
  let cellBase = 3 + pal * 3;

  let cx = clamp(i32(floor(in.uv.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(in.uv.y * f32(rows))), 0, rows - 1);
  let kind = i32(D[cellBase + cy * cols + cx]);

  // Faint 1m cell grid factor.
  let gf = abs(fract(in.uv * vec2f(f32(cols), f32(rows))) - vec2f(0.5));
  let edge = max(gf.x, gf.y);

  if (kind < 0) {
    let g = smoothstep(0.46, 0.5, edge) * 0.07;
    return vec4f(0.05 + g, 0.07 + g, 0.10 + g, 1.0);
  }
  let pbase = 3 + kind * 3;
  let col = vec3f(D[pbase], D[pbase + 1], D[pbase + 2]);
  let shade = mix(1.0, 0.78, smoothstep(0.44, 0.5, edge));
  return vec4f(col * shade, 1.0);
}
`;
