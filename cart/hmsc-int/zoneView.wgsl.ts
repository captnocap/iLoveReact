// zoneView.wgsl.ts — the zoning layer's surface: the painted tile ground with a
// translucent zone tint on top, in ONE Effect quad (no Effect-over-Effect alpha
// dependency). The buffer is the tile section (encodeTileMap) followed by the zone
// section (encodeZoneSection); the shader derives both offsets from the headers.
// (WGSL: no unary +, no backticks in comments.)
//
// D[] layout: [0]cols [1]rows [2]tilePalCount, tilePal rgb..., tileCells...,
// then at zBase: [zBase]cols [zBase+1]rows [zBase+2]zonePalCount, zonePal rgb...,
// zoneCells...

export const ZONE_VIEW_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let tpal = i32(D[2]);
  let tCellBase = 3 + tpal * 3;
  let zBase = tCellBase + cols * rows;
  let zpal = i32(D[zBase + 2]);
  let zCellBase = zBase + 3 + zpal * 3;

  let cx = clamp(i32(floor(in.uv.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(in.uv.y * f32(rows))), 0, rows - 1);
  let cell = cy * cols + cx;

  let gf = abs(fract(in.uv * vec2f(f32(cols), f32(rows))) - vec2f(0.5));
  let edge = max(gf.x, gf.y);

  // Tile ground (dim where unpainted).
  let tkind = i32(D[tCellBase + cell]);
  var col = vec3f(0.05, 0.07, 0.10);
  if (tkind >= 0) {
    let pb = 3 + tkind * 3;
    col = vec3f(D[pb], D[pb + 1], D[pb + 2]);
  }
  col = col * mix(1.0, 0.82, smoothstep(0.44, 0.5, edge));

  // Zone tint on top.
  let zkind = i32(D[zCellBase + cell]);
  if (zkind >= 0) {
    let zb = zBase + 3 + zkind * 3;
    let zc = vec3f(D[zb], D[zb + 1], D[zb + 2]);
    col = mix(col, zc, 0.5);
  }
  return vec4f(col, 1.0);
}
`;
