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
import { cellKey, type RoadStroke } from './roadData';

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
  /** Road strokes (ROADSTROKE-0610) — the authored centerline+profile objects.
   *  The chunk tile grids are saved COMPOSITED (road stamps included, exactly
   *  what the editor shows); the undercoat below is what re-editing restores. */
  roads?: RoadStroke[];
  /** Road undercoat: [gx, gz, priorLegendIdx] per road-stamped cell — the tile
   *  index (into tileLegend, -1 = empty) each cell held before the stamp. */
  roadUnder?: [number, number, number][];
}

export interface EditorWorld {
  chunks: Map<ChunkKey, Chunk>;
  zones: ZoneDef[];
  focus: Set<ChunkKey>;
  placements: Placement[];
  /** Road strokes (optional — pre-road worlds and worlds without roads omit them). */
  roads?: RoadStroke[];
  /** cellKey("gx,gz") → the tile index the cell held before the road stamp. */
  roadUnder?: Map<string, number>;
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
  // Road undercoat: cellKey → prior index. Values are CURRENT global indices,
  // which is exactly the legend this snapshot writes — remapped by name on load
  // like the tile grids.
  const roadUnder: [number, number, number][] = [];
  if (world.roadUnder) {
    for (const [key, prior] of world.roadUnder) {
      const i = key.indexOf(',');
      roadUnder.push([Number(key.slice(0, i)), Number(key.slice(i + 1)), prior]);
    }
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
    ...(world.roads?.length ? { roads: world.roads.map((r) => ({ id: r.id, points: r.points.map((pt) => ({ ...pt })), profile: { ...r.profile } })) } : {}),
    ...(roadUnder.length ? { roadUnder } : {}),
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

  // Road strokes ride the snapshot as plain data; the undercoat's prior indices
  // remap through the same saved-legend table the tile grids use.
  const roads: RoadStroke[] = (snap.roads ?? [])
    .filter((r) => r && Array.isArray(r.points) && r.points.length >= 2 && r.profile)
    .map((r) => ({
      id: r.id,
      points: r.points.map((p) => ({ gx: Math.round(p.gx), gz: Math.round(p.gz) })),
      profile: { lanesF: r.profile.lanesF, lanesB: r.profile.lanesB, sidewalks: !!r.profile.sidewalks },
    }));
  const roadUnder = new Map<string, number>();
  for (const entry of snap.roadUnder ?? []) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [gx, gz, prior] = entry;
    roadUnder.set(cellKey(gx, gz), prior == null || prior < 0 ? -1 : (remap[prior] ?? -1));
  }

  return { chunks, zones, focus, placements, roads, roadUnder };
}

// A fresh, blank map: one seed chunk (a0), focused, nothing painted.
export function emptyMap(): EditorWorld {
  const chunks = new Map<ChunkKey, Chunk>();
  chunks.set(chunkKey(0, 0), makeChunk(0, 0));
  return { chunks, zones: [], focus: new Set([chunkKey(0, 0)]), placements: [], roads: [], roadUnder: new Map() };
}

// The graph-space centre of everything painted — where the canvas should look
// when a map opens without a saved 2D view (MAPGONE2-0605: the default view
// sat at the lattice origin; on a map whose origin chunk is a featureless
// interior, the boot canvas read as "blank" while every byte was intact).
// Uses the chunk lattice law (chunk (cx,cz) is CENTRED at cx*PATCH —
// see ChunkSurface): cell (x,y) of chunk (cx,cz) sits at
// cx*PATCH − PATCH/2 + (x + 0.5)*tileUnits.
export type PaintedBounds = { minX: number; maxX: number; minY: number; maxY: number };

/** Graph-space bounding box of everything painted — null on a blank map. */
export function paintedBounds(world: EditorWorld, tileUnits: number): PaintedBounds | null {
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
  return any ? { minX, maxX, minY, maxY } : null;
}

export function paintedCenter(world: EditorWorld, tileUnits: number): { gx: number; gy: number } | null {
  const bounds = paintedBounds(world, tileUnits);
  if (!bounds) return null;
  return { gx: (bounds.minX + bounds.maxX) / 2, gy: (bounds.minY + bounds.maxY) / 2 };
}

/** True when a map carries authored world content, not just the blank seed chunk. */
export function hasAuthoredMapContent(world: EditorWorld): boolean {
  if (world.placements.length > 0 || world.zones.length > 0) return true;
  for (const c of world.chunks.values()) {
    for (let i = 0; i < c.tiles.idx.length; i++) if (c.tiles.idx[i] >= 0) return true;
    for (let i = 0; i < c.height.z.length; i++) if (c.height.z[i] !== 0) return true;
    for (let i = 0; i < c.zones.idx.length; i++) if (c.zones.idx[i] >= 0) return true;
  }
  return false;
}

// VIEWRUNAWAY-0605: the saved-view sanity law, applied at BOTH ends — the
// autosave never writes a view that fails it, and the restore rejects one
// that does (logged + paintedCenter fallback; the next autosave then
// overwrites the bad value, so a poisoned file self-heals).
export const VIEW_SANITY = {
  /** the host camera's own zoom clamp (framework/primitive/canvas.zig) */
  zoom: { min: 0.05, max: 100 },
  /** a sane view centre may wander this many chunks past the painted bounds
   *  (or past the origin chunk on a blank map) */
  marginChunks: 2,
} as const;

export function viewRunawayLogKey(view: { x: number; y: number; zoom: number }): string {
  return `${view.x.toFixed(0)},${view.y.toFixed(0)}@${view.zoom.toFixed(2)}`;
}

/** Is this saved/live 2D camera believable for this world? */
export function isSaneView2d(
  view: { x: number; y: number; zoom: number } | null | undefined,
  world: EditorWorld,
  tileUnits: number,
): boolean {
  if (!view) return false;
  if (!Number.isFinite(view.x) || !Number.isFinite(view.y) || !Number.isFinite(view.zoom)) return false;
  if (view.zoom < VIEW_SANITY.zoom.min || view.zoom > VIEW_SANITY.zoom.max) return false;
  const patch = CHUNK_TILES * tileUnits;
  const margin = VIEW_SANITY.marginChunks * patch;
  const bounds = paintedBounds(world, tileUnits) ?? { minX: -patch / 2, maxX: patch / 2, minY: -patch / 2, maxY: patch / 2 };
  return (
    view.x >= bounds.minX - margin && view.x <= bounds.maxX + margin &&
    view.y >= bounds.minY - margin && view.y <= bounds.maxY + margin
  );
}
