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

import type { Landform } from '../hmsc/design';
import { CHUNK_TILES, chunkKey, type Chunk, type ChunkKey } from './chunks';
import { encodeTileMap } from './tileData';
import { roadRibbonSegments, type RoadStroke } from './roadData';
import { plog } from './perfLog';

export const chunkFloorId = (cx: number, cz: number): string => `chunk_${cx}_${cz}`;
export const CHUNK_FLOOR_HF_RES = CHUNK_TILES + 1;

export type ChunkFloor = {
  cx: number;
  cz: number;
  tileData: number[]; // encodeTileMap — the floor texture (stable unless tiles painted)
  heights: number[];  // the height samples — mesh displacement (stable unless height painted)
  hcols: number;      // height-sample columns / rows (cols*rows = heights.length)
  hrows: number;
  hver: number;       // height version — bumps each height edit; drives the host's dynamic-slot overwrite
  // Analytic road ribbon segments over this chunk (ROADCURVE-0610), chunk-local
  // cell space, 8 floats/segment — stable identity unless a road changed.
  roads?: number[];
};

// Preview height-mesh resolution (vertices per side). The brush field is sampled
// finer than the mesh needs, but the floor mirror must resolve at least per tile.
// This helper lives outside PaintCanvas so hot-update restore can rebuild the
// runtime ground even when the hidden editor pane is not mounted.
export function downsampleChunkFloorHeights(z: Float32Array, cols: number, rows: number): number[] {
  const out = new Array<number>(CHUNK_FLOOR_HF_RES * CHUNK_FLOOR_HF_RES);
  const sx = (cols - 1) / (CHUNK_FLOOR_HF_RES - 1);
  const sy = (rows - 1) / (CHUNK_FLOOR_HF_RES - 1);
  const hx = Math.max(1, Math.ceil(sx / 2));
  const hy = Math.max(1, Math.ceil(sy / 2));
  for (let j = 0; j < CHUNK_FLOOR_HF_RES; j++) {
    const cy = Math.round(j * sy);
    for (let i = 0; i < CHUNK_FLOOR_HF_RES; i++) {
      const cx = Math.round(i * sx);
      let best = 0;
      for (let dy = -hy; dy <= hy; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -hx; dx <= hx; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= cols) continue;
          const v = z[yy * cols + xx];
          if (Math.abs(v) > Math.abs(best)) best = v;
        }
      }
      out[j * CHUNK_FLOOR_HF_RES + i] = best;
    }
  }
  return out;
}

export function chunkToFloor(c: Chunk, hver = 1, roads?: RoadStroke[]): ChunkFloor {
  const segs = roads?.length ? roadRibbonSegments(roads, c.cx, c.cz, CHUNK_TILES) : [];
  return {
    cx: c.cx,
    cz: c.cz,
    tileData: encodeTileMap(c.tiles),
    heights: downsampleChunkFloorHeights(c.height.z, c.height.cols, c.height.rows),
    hcols: CHUNK_FLOOR_HF_RES,
    hrows: CHUNK_FLOOR_HF_RES,
    hver,
    ...(segs.length ? { roads: segs } : {}),
  };
}

export function floorsFromEditorWorld(world: { chunks: Map<ChunkKey, Chunk>; focus: Set<ChunkKey>; roads?: RoadStroke[] }): ChunkFloor[] {
  const out: ChunkFloor[] = [];
  for (const c of world.chunks.values()) {
    if (!world.focus.has(chunkKey(c.cx, c.cz))) continue;
    out.push(chunkToFloor(c, 1, world.roads));
  }
  return out;
}

// A painted chunk → a REAL heightfield landform (the game's terrain layer). This
// is the bridge that makes the painter's strokes the world's terrain: the same
// height samples drive the displaced mesh AND the host collider, and the per-cell
// tile grid (decoded back out of the encoded tileData) drapes over it as the mesh
// texture. So the preview renders the chunk THROUGH the game's own landform path
// (WorldStatics) — preview == game — and buildings placed on it sit at its height.
// One landform per chunk; centred on the chunk, baseY 0. 1 tile = 1 m.
export function floorToLandform(f: ChunkFloor): Landform {
  // tileData = encodeTileMap: [cols, rows, palCount, palette rgb…, …cell idx]. The
  // raw per-cell grid is everything after the header + palette.
  const tcols = f.tileData[0] | 0;
  const trows = f.tileData[1] | 0;
  const palCount = f.tileData[2] | 0;
  const idx = f.tileData.slice(3 + palCount * 3);
  const cell = CHUNK_TILES / (f.hcols - 1); // height samples span the whole chunk
  return {
    id: `painted_${f.cx}_${f.cz}`,
    kind: 'heightfield',
    label: `painted ${f.cx},${f.cz}`,
    centerX: f.cx * CHUNK_TILES + CHUNK_TILES / 2,
    centerZ: f.cz * CHUNK_TILES + CHUNK_TILES / 2,
    baseY: 0,
    params: {},
    field: {
      cols: f.hcols, rows: f.hrows, cell, heights: f.heights,
      tiles: { cols: tcols, rows: trows, idx },
      ...(f.roads?.length ? { roads: f.roads } : {}),
    },
    createdByCommand: 'hmsc-int:paint',
  };
}

// STABLE-IDENTITY cache. The preview's <Landform>, <LandformCapture>, and
// <HeightfieldSurfaceCapture> are all memo'd on landform IDENTITY, so handing them
// a fresh Landform object for every chunk on every region-sync makes all N chunks
// re-bake their offscreen textures every sync — even the ones you didn't touch.
// That 11x re-bake is what froze the 2D paint (each sync blocked the main thread
// ~370ms). A chunk is UNCHANGED when its tileData AND heights array refs are
// unchanged — buildFloors reuses the cached encode for chunks it didn't re-encode,
// so those refs are stable across syncs. Identity-compare them and reuse the prior
// Landform object, so only the chunk you actually painted gets a new identity (and
// re-bakes). Keyed by chunk id; entries for chunks that drop out (unfocused) are
// pruned so the cache never pins a freed buffer.
type LandformCacheEntry = { tileData: number[]; heights: number[]; hver: number; roads?: number[]; landform: Landform };
const landformCache = new Map<string, LandformCacheEntry>();

export function floorsToLandforms(floors: ChunkFloor[]): Landform[] {
  const live = new Set<string>();
  let rebuilt = 0, reused = 0;
  const out = floors.map((f) => {
    const id = chunkFloorId(f.cx, f.cz);
    live.add(id);
    const hit = landformCache.get(id);
    if (hit && hit.tileData === f.tileData && hit.heights === f.heights && hit.hver === f.hver && hit.roads === f.roads) {
      reused++;
      return hit.landform; // unchanged chunk → SAME object → preview memo-skips it
    }
    rebuilt++;
    const landform = floorToLandform(f);
    landformCache.set(id, { tileData: f.tileData, heights: f.heights, hver: f.hver, roads: f.roads, landform });
    return landform;
  });
  for (const id of landformCache.keys()) if (!live.has(id)) landformCache.delete(id);
  // The fix is working when rebuilt=1 (only the painted chunk) and reused=N-1 on a
  // mid-stroke sync. rebuilt=N every sync = stable identity broke → preview re-bakes
  // everything again (the choke is back).
  plog('landforms', `rebuilt=${rebuilt} reused=${reused} (only rebuilt chunks re-bake in the preview)`);
  return out;
}
