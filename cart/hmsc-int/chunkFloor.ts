// chunkFloor.ts — bridge from the editor's painted chunks to the iso-3D preview's
// floor meshes, with STABLE per-chunk identity.
//
// Earlier this greedy-merged painted cells into per-kind rectangles. That churned
// the region/capture set on every paint (rect anchors shift cell-by-cell), so the
// per-region StaticSurface bind groups were torn down and recreated mid-stroke —
// and the 3D floor draw referenced a freed bind group → a hard wgpu panic
// (BindGroup does not exist, 3d.zig setBindGroup).
//
// Fix: ONE floor per chunk. Each focused chunk is a single 120x120 slab whose
// texture is the chunk's per-cell tile field (the SAME shader the 2D canvas uses).
// The capture is keyed by chunk coord, so it never churns — painting just re-bakes
// the texture in place. The region/mesh/capture set only changes on focus toggles
// (rare), never during a stroke.

import { chunkKey, CHUNK_TILES, type Chunk, type ChunkKey } from './chunks';
import { encodeTileMap } from './tileData';
import type { TileKind, WorldSurfaceRegion } from '../hmsc/design';

// A flat, thin kind — only its slab thickness/top is used; the per-cell texture
// carries the actual look.
export const CHUNK_FLOOR_KIND: TileKind = 'sidewalk';

// A focused chunk's floor snapshot: its grid position + a FRESH tile encoding
// (new array identity so the capture re-bakes) of the live buffer.
export type ChunkFloor = { cx: number; cz: number; data: number[] };

export const chunkFloorId = (cx: number, cz: number): string => `chunk_${cx}_${cz}`;

// The floor mesh's region: the whole chunk at its world-cell corner. region.id ==
// chunkFloorId so FloorMesh's floorTextureKey(region.id) matches our capture.
export function chunkFloorRegion(cx: number, cz: number): WorldSurfaceRegion {
  return {
    id: chunkFloorId(cx, cz),
    label: `chunk ${cx},${cz}`,
    kind: CHUNK_FLOOR_KIND,
    x: cx * CHUNK_TILES,
    y: 0,
    z: cz * CHUNK_TILES,
    width: CHUNK_TILES,
    depth: CHUNK_TILES,
    zoneKey: chunkFloorId(cx, cz),
  };
}

// The focused chunks as floor snapshots — the throttled mirror PaintCanvas sends up.
export function focusedFloors(chunks: Map<ChunkKey, Chunk>, focus: Set<ChunkKey>): ChunkFloor[] {
  const out: ChunkFloor[] = [];
  for (const c of chunks.values()) {
    if (focus.has(chunkKey(c.cx, c.cz))) out.push({ cx: c.cx, cz: c.cz, data: encodeTileMap(c.tiles) });
  }
  return out;
}
