// chunkFloor.ts — the per-chunk floor snapshot the 2D painter sends to the 3D
// preview, with STABLE per-chunk identity.
//
// Each focused chunk becomes ONE displaced, textured floor mesh in the preview:
//   • texture  = the chunk's per-cell tile field (tileData), captured offscreen,
//                keyed by chunk coord — painting re-bakes it in place.
//   • geometry = a Heightfield mesh displaced by the chunk's height buffer.
//
// Keying captures/meshes by chunk (never by transient rectangles) is what keeps
// wgpu from tearing down a bind group mid-draw (the old per-rectangle churn that
// crashed). tileData and heights are cached + dirty-tracked upstream so a tile
// stroke never regenerates the height mesh and a height stroke never re-bakes the
// texture.

export const chunkFloorId = (cx: number, cz: number): string => `chunk_${cx}_${cz}`;

export type ChunkFloor = {
  cx: number;
  cz: number;
  tileData: number[]; // encodeTileMap — the floor texture (stable unless tiles painted)
  heights: number[];  // the height samples — mesh displacement (stable unless height painted)
  hcols: number;      // height-sample columns / rows (cols*rows = heights.length)
  hrows: number;
};
