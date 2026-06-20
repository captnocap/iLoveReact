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
import { TILE_KINDS } from './world/tileKinds';
import { FLORA_KINDS, FLORA_LAYER_COUNT, FLORA_LAYERS, paintFlora } from './floraData';
import {
  chunkKey,
  makeChunk,
  CHUNK_TILES,
  type Chunk,
  type ChunkKey,
} from './chunks';
import { type ZoneDef } from './zoneData';
import { placementCellRect, resolvePlaceable, type Placement, type PlaceCat } from './placements';
import { cellKey, planRoads, type RoadStroke } from './roadData';
import { type GenPoseOverride, type IntersectionControl } from './intersections';

// Map format version. v1 stored the road RASTER baked into the tile grids plus a
// `roadUnder` undercoat to reverse it — the recipe (roads) AND its result (tiles)
// AND the data to un-bake, all side by side (GUIDING_LIGHT: store the factors,
// not the product). v2 stores the BASE terrain only + the stroke recipe, and
// re-derives the road grid at load via planRoads (the same pure compiler the
// editor runs at paint time). v1 snapshots still load (their tiles are already
// composited; their `roadUnder` rides as before).
// v3 (FLORADECOUPLE-0619) adds the flora channel (per-cell populations) + floraLegend.
// A v2 snapshot has no flora grid; on load its population TILES (grass*/palm*/bush)
// MIGRATE into the flora channel (POP_TILE_TO_FLORA) and the ground under them resets
// to a plain surface, so existing maps keep their grass/palms over a separable ground.
// v4 makes flora additive by storing separate grass/tree/bush lanes in that channel.
const MAP_FORMAT_V = 4;

// v2→v3 migration: a population kind that used to live in the GROUND tile channel maps
// to its flora kind + the plain ground it should sit on. Names match the saved v2
// tileLegend on the left; FLORA_KINDS / TILE_KINDS names on the right.
const POP_TILE_TO_FLORA: Readonly<Record<string, { flora: string; ground: string }>> = {
  grassSparse: { flora: 'grassSparse', ground: 'grass' },
  grass: { flora: 'grassMed', ground: 'grass' },
  grassDry: { flora: 'grassDry', ground: 'grass' },
  grassLush: { flora: 'grassLush', ground: 'grass' },
  palmSparse: { flora: 'palmSparse', ground: 'grass' },
  palm: { flora: 'palmMed', ground: 'grass' },
  palmDense: { flora: 'palmDense', ground: 'grass' },
  bush: { flora: 'bush', ground: 'grass' },
};

// Re-derive the road raster onto the base chunks from the stroke recipe — the
// load-time half of the v2 "store recipe, not result" format. planRoads is
// authoritative, so it OVERWRITES whatever sits in road cells; only non-road base
// terrain needs to survive serialization. Returns the rebuilt roadUnder (each
// stamped cell's prior BASE tile) so the live editor can un-stamp on re-edit.
function stampRoadsOntoChunks(chunks: Map<ChunkKey, Chunk>, roads: readonly RoadStroke[]): Map<string, number> {
  const under = new Map<string, number>();
  if (!roads.length) return under;
  for (const [key, kind] of planRoads([...roads])) {
    const i = key.indexOf(',');
    const gx = Number(key.slice(0, i));
    const gz = Number(key.slice(i + 1));
    const cx = Math.floor(gx / CHUNK_TILES);
    const cz = Math.floor(gz / CHUNK_TILES);
    const c = chunks.get(chunkKey(cx, cz));
    if (!c) continue;
    const lx = gx - cx * CHUNK_TILES;
    const lz = gz - cz * CHUNK_TILES;
    if (lx < 0 || lx >= c.tiles.cols || lz < 0 || lz >= c.tiles.rows) continue;
    const ci = lz * c.tiles.cols + lx;
    const prior = c.tiles.idx[ci];
    under.set(cellKey(gx, gz), prior == null ? -1 : prior);
    c.tiles.idx[ci] = TILE_KINDS.indexOf(kind);
  }
  return under;
}

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
  // Per-instance text (a street-name sign, channel letters) — instance data, not
  // re-resolvable from the kind, so it must ride the snapshot.
  text?: string;
  // INTERSECTIONS-0619: the generated-prop id (gen:{junctionKey}:{side}:{role}).
  // Generated intersection props DO persist (the compiled bake reads the saved
  // world, which has no editor to re-derive them); the editor reconciles them on
  // load. The tag preserves the manual-move override link.
  gen?: string;
}

interface ChunkSnap {
  cx: number;
  cz: number;
  tiles: RleGrid;   // per-cell index into tileLegend (-1 = empty)
  height: RleGrid;  // per-sample quantized height (round(z * HEIGHT_Q); 0 = flat)
  zones: RleGrid;   // per-cell index into `zones` list (-1 = unzoned)
  water?: RleGrid;  // per-sample quantized WATER surface level (>0 = wet); absent = dry
  flora?: RleGrid;  // per-cell/layer index into floraLegend (-1 = none); absent = bare
  floraLayerCount?: number;
}

export interface MapSnapshot {
  /** Internal snapshot schema; bump if the codec shape changes. */
  v: number;
  /** Tile-kind NAMES in the index order the chunk tile grids reference. */
  tileLegend: string[];
  /** Flora-kind NAMES the chunk flora grids reference (FLORADECOUPLE-0619). Absent
   *  on pre-flora snapshots — those migrate population tiles into flora on load. */
  floraLegend?: string[];
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
  /** INTERSECTIONS-0619: per-junction control overrides (junctionKey → type) and
   *  per-id pose overrides for manually-dragged generated props. The generated
   *  props themselves are NOT saved — they re-derive from roads+these on load. */
  intersectionControls?: [string, IntersectionControl][];
  intersectionOverrides?: [string, GenPoseOverride][];
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
  /** INTERSECTIONS-0619: authored junction control types + manual-move overrides. */
  intersectionControls?: Map<string, IntersectionControl>;
  intersectionOverrides?: Map<string, GenPoseOverride>;
}

// ── Encode ─────────────────────────────────────────────────────────────────

export function serializeMap(world: EditorWorld): MapSnapshot {
  // v2 stores the BASE terrain only — un-stamp the road raster using roadUnder
  // (each road cell's prior tile) so what's saved is base + the stroke recipe,
  // never the baked product. Road cells whose prior is itself a road (overlaps)
  // are harmless: planRoads re-derives all road cells at load, overwriting them.
  const under = world.roadUnder;
  const chunks: ChunkSnap[] = [];
  for (const c of world.chunks.values()) {
    // Heights → quantized integers (mostly 0), then row-RLE.
    const hz = c.height.z;
    const q = new Array<number>(hz.length);
    for (let i = 0; i < hz.length; i++) q[i] = Math.round(hz[i] * HEIGHT_Q);
    // Painted water surface (mostly 0/dry) → the same quantize + RLE as height.
    const wz = c.water.z;
    let anyWater = false;
    const wq = new Array<number>(wz.length);
    for (let i = 0; i < wz.length; i++) { wq[i] = Math.round(wz[i] * HEIGHT_Q); if (wq[i] !== 0) anyWater = true; }
    // Flora cells (mostly -1/none) → RLE, only when something grows on this chunk.
    // Stored by lane so grass + trees + bushes can stack in the same cell.
    const fidx: number[] = [];
    let anyFlora = false;
    for (const layer of FLORA_LAYERS) {
      const cells = c.flora.layers[layer];
      for (let i = 0; i < cells.length; i++) {
        const v = cells[i];
        fidx.push(v);
        if (v >= 0) anyFlora = true;
      }
    }
    const baseIdx = Array.from(c.tiles.idx);
    if (under && under.size) {
      const cx0 = c.cx * CHUNK_TILES;
      const cz0 = c.cz * CHUNK_TILES;
      for (const [key, prior] of under) {
        const i = key.indexOf(',');
        const lx = Number(key.slice(0, i)) - cx0;
        const lz = Number(key.slice(i + 1)) - cz0;
        if (lx < 0 || lx >= c.tiles.cols || lz < 0 || lz >= c.tiles.rows) continue;
        baseIdx[lz * c.tiles.cols + lx] = prior;
      }
    }
    chunks.push({
      cx: c.cx,
      cz: c.cz,
      tiles: encodeGrid(baseIdx, c.tiles.cols, c.tiles.rows),
      height: encodeGrid(q, c.height.cols, c.height.rows),
      zones: encodeGrid(Array.from(c.zones.idx), c.zones.cols, c.zones.rows),
      ...(anyWater ? { water: encodeGrid(wq, c.water.cols, c.water.rows) } : {}),
      ...(anyFlora ? { flora: encodeGrid(fidx, c.flora.cols, c.flora.rows * FLORA_LAYER_COUNT), floraLayerCount: FLORA_LAYER_COUNT } : {}),
    });
  }
  return {
    v: MAP_FORMAT_V,
    tileLegend: [...TILE_KINDS],
    floraLegend: [...FLORA_KINDS],
    zones: world.zones.map((z) => ({ ...z, flags: [...z.flags] })),
    focus: Array.from(world.focus),
    // Gen-tagged intersection props (stop signs / lights / street signs) PERSIST:
    // the compiled bake reads the saved world (no editor to re-derive them), so
    // filtering them out made the signs vanish in-game (req_1485). The editor
    // reconciles them on load from roads + the control/override maps below; text
    // and the gen tag ride along (instance data, not re-resolvable from the kind).
    placements: world.placements.map((p) => ({
      id: p.id, cat: p.cat, kind: p.kind, gx: p.gx, gy: p.gy, rotation: p.rotation, locked: p.locked,
      ...(p.spawnId ? { spawnId: p.spawnId } : {}),
      ...(p.text ? { text: p.text } : {}),
      ...(p.gen ? { gen: p.gen } : {}),
    })),
    chunks,
    // The recipe: stroke centerlines + profile (+ name). The road raster is DERIVED
    // from this at load (planRoads), not stored. profile spreads whole so new fields
    // (speedLimitKph, …) ride automatically. No roadUnder in v2 — the base IS the
    // un-stamped grid, and load rebuilds the undercoat by re-stamping.
    ...(world.roads?.length ? { roads: world.roads.map((r) => ({ id: r.id, ...(r.name ? { name: r.name } : {}), points: r.points.map((pt) => ({ ...pt })), profile: { ...r.profile } })) } : {}),
    ...(world.intersectionControls?.size ? { intersectionControls: [...world.intersectionControls] } : {}),
    ...(world.intersectionOverrides?.size ? { intersectionOverrides: [...world.intersectionOverrides] } : {}),
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

// saved flora index → current FLORA_KINDS index, via the saved legend's name (twin of
// buildTileRemap). A kind that no longer exists degrades to -1 (none).
function buildFloraRemap(legend: string[]): Int16Array {
  const remap = new Int16Array(legend.length);
  for (let i = 0; i < legend.length; i++) {
    remap[i] = FLORA_KINDS.indexOf(legend[i] as (typeof FLORA_KINDS)[number]);
  }
  return remap;
}

export function deserializeMap(snap: MapSnapshot): EditorWorld {
  const savedTileLegend = snap.tileLegend ?? [...TILE_KINDS];
  const remap = buildTileRemap(savedTileLegend);
  const floraRemap = buildFloraRemap(snap.floraLegend ?? [...FLORA_KINDS]);
  // v2→v3 migration map: saved tile index → its flora + ground split, for population
  // kinds only (null for real ground tiles). Applied ONLY to chunks with no flora grid.
  const tileMigration: ({ flora: number; ground: number } | null)[] = savedTileLegend.map((name) => {
    const m = POP_TILE_TO_FLORA[name];
    if (!m) return null;
    return { flora: FLORA_KINDS.indexOf(m.flora as (typeof FLORA_KINDS)[number]), ground: TILE_KINDS.indexOf(m.ground as (typeof TILE_KINDS)[number]) };
  });
  const chunks = new Map<ChunkKey, Chunk>();

  for (const cs of snap.chunks ?? []) {
    const c = makeChunk(cs.cx, cs.cz);
    const hasFloraGrid = !!cs.flora;

    const tflat = decodeGrid(cs.tiles);
    for (let i = 0; i < c.tiles.idx.length && i < tflat.length; i++) {
      const v = tflat[i];
      if (v == null || v < 0) { c.tiles.idx[i] = -1; continue; }
      const mig = !hasFloraGrid ? tileMigration[v] : null;
      if (mig) {
        // Pre-flora map: this cell's GROUND tile was a population — split it.
        paintFlora(c.flora, i % c.flora.cols, Math.floor(i / c.flora.cols), mig.flora);
        c.tiles.idx[i] = mig.ground;
      } else {
        c.tiles.idx[i] = remap[v] ?? -1;
      }
    }

    if (cs.flora) {
      const fflat = decodeGrid(cs.flora);
      const cellN = c.flora.cols * c.flora.rows;
      const layerCount = Math.max(1, cs.floraLayerCount ?? 1);
      if (layerCount > 1) {
        for (let li = 0; li < FLORA_LAYERS.length && li < layerCount; li += 1) {
          const dst = c.flora.layers[FLORA_LAYERS[li]];
          const offset = li * cellN;
          for (let i = 0; i < dst.length && offset + i < fflat.length; i++) {
            const v = fflat[offset + i];
            dst[i] = v == null || v < 0 ? -1 : (floraRemap[v] ?? -1);
          }
        }
      } else {
        // v3 single-slot flora: preserve each cell by placing its kind into that
        // kind's lane. This immediately allows later grass/tree/bush stacking.
        for (let i = 0; i < cellN && i < fflat.length; i++) {
          const v = fflat[i];
          const kind = v == null || v < 0 ? -1 : (floraRemap[v] ?? -1);
          if (kind >= 0) paintFlora(c.flora, i % c.flora.cols, Math.floor(i / c.flora.cols), kind);
        }
      }
    }

    const hflat = decodeGrid(cs.height);
    for (let i = 0; i < c.height.z.length && i < hflat.length; i++) {
      const v = hflat[i];
      c.height.z[i] = v == null ? 0 : v / HEIGHT_Q;
    }

    if (cs.water) {
      const wflat = decodeGrid(cs.water);
      for (let i = 0; i < c.water.z.length && i < wflat.length; i++) {
        const v = wflat[i];
        c.water.z[i] = v == null ? 0 : v / HEIGHT_Q;
      }
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
    return { id: p.id, cat: p.cat, kind: p.kind, gx: snap.snapGx, gy: snap.snapGy, rotation: p.rotation, locked: p.locked, ...base, ...(p.spawnId ? { spawnId: p.spawnId } : {}), ...(p.text ? { text: p.text } : {}), ...(p.gen ? { gen: p.gen } : {}) };
  });

  const focusKeys = (snap.focus ?? []).filter((k) => chunks.has(k));
  const focus = new Set<ChunkKey>(focusKeys.length ? focusKeys : Array.from(chunks.keys()));

  // Road strokes ride the snapshot as plain data; the undercoat's prior indices
  // remap through the same saved-legend table the tile grids use.
  const roads: RoadStroke[] = (snap.roads ?? [])
    .filter((r) => r && Array.isArray(r.points) && r.points.length >= 2 && r.profile)
    .map((r) => ({
      id: r.id,
      ...(typeof r.name === 'string' && r.name.length ? { name: r.name } : {}),
      points: r.points.map((p) => ({ gx: Math.round(p.gx), gz: Math.round(p.gz) })),
      profile: {
        lanesF: r.profile.lanesF,
        lanesB: r.profile.lanesB,
        sidewalks: !!r.profile.sidewalks,
        // ROADSPEED-0610: absent on pre-speed saves — clampProfile defaults it
        ...(Number.isFinite(r.profile.speedLimitKph) ? { speedLimitKph: r.profile.speedLimitKph } : {}),
      },
    }));
  // v2: the saved tiles are BASE terrain — re-derive the road raster from the
  // stroke recipe (the same planRoads the editor runs at paint), which also
  // rebuilds the undercoat. v1: the tiles are already composited; take the saved
  // undercoat as-is (remapped through the saved legend like the tile grids).
  let roadUnder: Map<string, number>;
  if ((snap.v ?? 1) >= 2) {
    roadUnder = stampRoadsOntoChunks(chunks, roads);
  } else {
    roadUnder = new Map<string, number>();
    for (const entry of snap.roadUnder ?? []) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      const [gx, gz, prior] = entry;
      roadUnder.set(cellKey(gx, gz), prior == null || prior < 0 ? -1 : (remap[prior] ?? -1));
    }
  }

  const intersectionControls = new Map<string, IntersectionControl>(snap.intersectionControls ?? []);
  const intersectionOverrides = new Map<string, GenPoseOverride>(snap.intersectionOverrides ?? []);

  return { chunks, zones, focus, placements, roads, roadUnder, intersectionControls, intersectionOverrides };
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
