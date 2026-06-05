// mapStore.ts — serialize / deserialize ONE map (a named world project).
//
// A "map" is the editor's unit of work, and the workspace holds MANY of them
// (the city, every building interior, ...). This module is the codec between a
// live editor world (the chunk registry + zone defs + placements + focus) and a
// JSON-able MapSnapshot that lives in the session payload (see index.tsx).
//
// THE RULE (globals are shared, maps are thin references):
//   A map NEVER bakes in a global definition. It stores REFERENCES so a global
//   change propagates to every map that uses it. Concretely —
//     • tiles      → a per-cell index, plus a `tileLegend` of kind NAMES. On
//                    load we remap saved-index → name → current TILE_KINDS index,
//                    so reordering / recolouring a tile kind globally flows into
//                    every saved map (and a removed kind degrades to empty, not
//                    a wrong colour).
//     • placements → only { id, cat, kind, pose }. Footprint / colour / label are
//                    RE-RESOLVED from the kind registries on load (resolvePlaceable),
//                    so editing a building's footprint globally moves every instance.
//   Per-INSTANCE overrides are a separate, later feature — not stored here yet.
//
// Per-map data that IS self-contained: zone defs (a map's named areas) + the
// per-cell zone membership, the focused-chunk set, and chunk geometry.
//
// Buffers are run-length encoded (one shared grid codec, @reactjit/workspace/rle)
// — every chunk buffer is mostly empty/flat, so RLE keeps the autosave tiny and
// off the paint hot path.

import { encodeGrid, decodeGrid, type RleGrid } from '@reactjit/workspace';
import { TILE_KINDS } from '../hmsc/world/tileKinds';
import {
  chunkKey,
  makeChunk,
  CHUNK_TILES,
  type Chunk,
  type ChunkKey,
} from './chunks';
import { type ZoneDef } from './zoneData';
import { placementCellRect, resolvePlaceable, type Placement, type PlaceCat } from './placements';

// Height quantization: heights are metres in ±HEIGHT_LIMIT. 0.01m steps are
// imperceptible on the coarse preview mesh and keep the value a small integer
// (e.g. ±6400 at HEIGHT_LIMIT=64) that RLE-collapses to nothing across flat ground.
const HEIGHT_Q = 100;

// A placement as stored: identity + kind reference + pose. Everything visual is
// re-resolved from globals on load (see THE RULE above).
interface PlacementSnap {
  id: string;
  cat: PlaceCat;
  kind: string;
  gx: number;
  gy: number;
  rotation: number;
  locked: boolean;
  // The save↔spawn link on a 'save' marker (the id of its paired 'spawn' marker).
  // Per-INSTANCE, not re-resolvable from the kind, so unlike footprint/colour it
  // must ride the snapshot or the pairing is lost on reload.
  spawnId?: string;
}

interface ChunkSnap {
  cx: number;
  cz: number;
  tiles: RleGrid;   // per-cell index into tileLegend (-1 = empty)
  height: RleGrid;  // per-sample quantized height (round(z * HEIGHT_Q); 0 = flat)
  zones: RleGrid;   // per-cell index into `zones` list (-1 = unzoned)
}

export interface MapSnapshot {
  /** Internal snapshot schema; bump if the codec shape changes. */
  v: number;
  /** Tile-kind NAMES in the index order the chunk tile grids reference. */
  tileLegend: string[];
  /** This map's named areas (self-contained — not global). */
  zones: ZoneDef[];
  /** Focused chunk keys ("cx,cz"). */
  focus: string[];
  /** Object placements (thin references; visuals re-resolved on load). */
  placements: PlacementSnap[];
  chunks: ChunkSnap[];
}

export interface EditorWorld {
  chunks: Map<ChunkKey, Chunk>;
  zones: ZoneDef[];
  focus: Set<ChunkKey>;
  placements: Placement[];
}

// ── Encode ─────────────────────────────────────────────────────────────────

export function serializeMap(world: EditorWorld): MapSnapshot {
  const chunks: ChunkSnap[] = [];
  for (const c of world.chunks.values()) {
    // Heights → quantized integers (mostly 0), then row-RLE.
    const hz = c.height.z;
    const q = new Array<number>(hz.length);
    for (let i = 0; i < hz.length; i++) q[i] = Math.round(hz[i] * HEIGHT_Q);
    chunks.push({
      cx: c.cx,
      cz: c.cz,
      tiles: encodeGrid(Array.from(c.tiles.idx), c.tiles.cols, c.tiles.rows),
      height: encodeGrid(q, c.height.cols, c.height.rows),
      zones: encodeGrid(Array.from(c.zones.idx), c.zones.cols, c.zones.rows),
    });
  }
  return {
    v: 1,
    tileLegend: [...TILE_KINDS],
    zones: world.zones.map((z) => ({ ...z, flags: [...z.flags] })),
    focus: Array.from(world.focus),
    placements: world.placements.map((p) => ({
      id: p.id, cat: p.cat, kind: p.kind, gx: p.gx, gy: p.gy, rotation: p.rotation, locked: p.locked,
      ...(p.spawnId ? { spawnId: p.spawnId } : {}),
    })),
    chunks,
  };
}

// ── Decode ─────────────────────────────────────────────────────────────────

// saved tile index → current global index, via the saved legend's name. A kind
// that no longer exists globally degrades to -1 (empty), never a wrong colour.
function buildTileRemap(legend: string[]): Int16Array {
  const remap = new Int16Array(legend.length);
  for (let i = 0; i < legend.length; i++) {
    const cur = TILE_KINDS.indexOf(legend[i] as (typeof TILE_KINDS)[number]);
    remap[i] = cur;
  }
  return remap;
}

export function deserializeMap(snap: MapSnapshot): EditorWorld {
  const remap = buildTileRemap(snap.tileLegend ?? [...TILE_KINDS]);
  const chunks = new Map<ChunkKey, Chunk>();

  for (const cs of snap.chunks ?? []) {
    const c = makeChunk(cs.cx, cs.cz);

    const tflat = decodeGrid(cs.tiles);
    for (let i = 0; i < c.tiles.idx.length && i < tflat.length; i++) {
      const v = tflat[i];
      const idx = v == null || v < 0 ? -1 : (remap[v] ?? -1);
      c.tiles.idx[i] = idx;
    }

    const hflat = decodeGrid(cs.height);
    for (let i = 0; i < c.height.z.length && i < hflat.length; i++) {
      const v = hflat[i];
      c.height.z[i] = v == null ? 0 : v / HEIGHT_Q;
    }

    const zflat = decodeGrid(cs.zones);
    for (let i = 0; i < c.zones.idx.length && i < zflat.length; i++) {
      const v = zflat[i];
      c.zones.idx[i] = v == null ? -1 : v;
    }

    chunks.set(chunkKey(cs.cx, cs.cz), c);
  }

  // Always have at least the seed chunk so a blank/corrupt map still opens.
  if (chunks.size === 0) chunks.set(chunkKey(0, 0), makeChunk(0, 0));

  const zones: ZoneDef[] = (snap.zones ?? []).map((z) => ({
    id: z.id, name: z.name, color: z.color, flags: [...(z.flags ?? [])],
  }));

  const placements: Placement[] = (snap.placements ?? []).map((p) => {
    const base = resolvePlaceable(p.cat, p.kind); // re-resolve visuals from globals
    // Snap on load: maps saved before snapping (or with old kind footprints) carry
    // free positions; quantize to the cell rect so the resting node always shows
    // the exact tiles the compile lowers to.
    const snap = placementCellRect({ gx: p.gx, gy: p.gy, footW: base.footW, footD: base.footD });
    return { id: p.id, cat: p.cat, kind: p.kind, gx: snap.snapGx, gy: snap.snapGy, rotation: p.rotation, locked: p.locked, ...base, ...(p.spawnId ? { spawnId: p.spawnId } : {}) };
  });

  const focusKeys = (snap.focus ?? []).filter((k) => chunks.has(k));
  const focus = new Set<ChunkKey>(focusKeys.length ? focusKeys : Array.from(chunks.keys()));

  return { chunks, zones, focus, placements };
}

// A fresh, blank map: one seed chunk (a0), focused, nothing painted.
export function emptyMap(): EditorWorld {
  const chunks = new Map<ChunkKey, Chunk>();
  chunks.set(chunkKey(0, 0), makeChunk(0, 0));
  return { chunks, zones: [], focus: new Set([chunkKey(0, 0)]), placements: [] };
}

// The graph-space centre of everything painted — where the canvas should look
// when a map opens without a saved 2D view (MAPGONE2-0605: the default view
// sat at the lattice origin; on a map whose origin chunk is a featureless
// interior, the boot canvas read as "blank" while every byte was intact).
// Uses the chunk lattice law (chunk (cx,cz) is CENTRED at cx*PATCH —
// see ChunkSurface): cell (x,y) of chunk (cx,cz) sits at
// cx*PATCH − PATCH/2 + (x + 0.5)*tileUnits.
export function paintedCenter(world: EditorWorld, tileUnits: number): { gx: number; gy: number } | null {
  const patch = CHUNK_TILES * tileUnits;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const c of world.chunks.values()) {
    const baseX = c.cx * patch - patch / 2;
    const baseY = c.cz * patch - patch / 2;
    for (let i = 0; i < c.tiles.idx.length; i++) {
      if (c.tiles.idx[i] < 0) continue;
      any = true;
      const x = baseX + ((i % c.tiles.cols) + 0.5) * tileUnits;
      const y = baseY + (Math.floor(i / c.tiles.cols) + 0.5) * tileUnits;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!any) return null;
  return { gx: (minX + maxX) / 2, gy: (minY + maxY) / 2 };
}
