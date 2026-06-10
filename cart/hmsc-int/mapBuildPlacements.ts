// mapBuildPlacements.ts — the 2D map editor's view of V24 build pieces.
//
// The map place layer still owns props/markers in its workspace payload, but
// buildings are the game/build semantic stream. These helpers are the bridge:
// canvas graph coordinates <-> world meters, prefab palette footprints, and
// top-down footprints for already-placed semantic pieces.

import { CHUNK_TILES } from './chunks';
import { TILE_UNITS } from './heightData';
import { GAME_BUILD, type BuildPrefabDef, type PlacedBuildPiece } from './game';

export type MapBuildPlaceable = {
  cat: 'building';
  kind: string;
  label: string;
  color: string;
  footW: number;
  footD: number;
  rotation: number;
};

export type MapBuildFootprint = {
  id: string;
  label: string;
  gx: number;
  gy: number;
  footW: number;
  footD: number;
  color: string;
  pieceIds: string[];
};

const BUILDING_SWATCH = '#38bdf8';

export function graphToBuildWorld(gx: number, gy: number): { x: number; y: number; z: number } {
  return {
    x: gx / TILE_UNITS + CHUNK_TILES / 2,
    y: 0,
    z: gy / TILE_UNITS + CHUNK_TILES / 2,
  };
}

export function buildWorldToGraph(x: number, z: number): { gx: number; gy: number } {
  return {
    gx: (x - CHUNK_TILES / 2) * TILE_UNITS,
    gy: (z - CHUNK_TILES / 2) * TILE_UNITS,
  };
}

function envelope(pieces: readonly Omit<PlacedBuildPiece, 'id'>[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const piece of pieces) {
    const b = GAME_BUILD.placed.bounds({ ...piece, id: 'preview' });
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  return { minX, maxX, minZ, maxZ };
}

export function mapBuildPlaceable(prefab: BuildPrefabDef, rotation = 0): MapBuildPlaceable {
  const stamped = GAME_BUILD.placed.stamp(prefab, { x: 0, y: 0, z: 0 }, rotation);
  const e = envelope(stamped);
  return {
    cat: 'building',
    kind: prefab.id,
    label: prefab.label,
    color: BUILDING_SWATCH,
    footW: Math.max(1, e.maxX - e.minX),
    footD: Math.max(1, e.maxZ - e.minZ),
    rotation,
  };
}

// Footprint grouping cached on the pieces ARRAY identity (PLACEPERF-0610, the
// same invariant the spatial grid and join-signature caches key on): the shell
// recomputes footprints on EVERY render, and the grouping walks connectivity —
// uncached at ~4.9k pieces this re-ran a multi-second pass per render (the
// post-move "stopwatch" stall, req_0502). The old inner lookup was also
// O(N) `pieces.find` per member id — now an id map.
const footprintsCache = new WeakMap<readonly PlacedBuildPiece[], MapBuildFootprint[]>();

export function mapBuildFootprints(pieces: readonly PlacedBuildPiece[]): MapBuildFootprint[] {
  const cached = footprintsCache.get(pieces);
  if (cached) return cached;
  const t0 = (globalThis as any).__bench_now_us ? Number((globalThis as any).__bench_now_us()) / 1000 : Date.now();
  const out: MapBuildFootprint[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, PlacedBuildPiece>();
  for (const piece of pieces) byId.set(piece.id, piece);
  const byStamp = new Map<string, PlacedBuildPiece[]>();
  for (const piece of pieces) {
    if (!piece.stampId) continue;
    const list = byStamp.get(piece.stampId) ?? [];
    list.push(piece);
    byStamp.set(piece.stampId, list);
  }
  for (const [stampId, group] of byStamp) {
    for (const piece of group) seen.add(piece.id);
    out.push(footprintFromGroup(stampId, `Building ${out.length + 1}`, group));
  }
  for (const seed of pieces) {
    if (seen.has(seed.id)) continue;
    const ids = [...GAME_BUILD.placed.connected(seed.id, pieces)].sort();
    for (const id of ids) seen.add(id);
    const group = ids.map((id) => byId.get(id)).filter((piece): piece is PlacedBuildPiece => !!piece);
    if (group.length) out.push(footprintFromGroup(ids[0], group.length === 1 ? GAME_BUILD.catalog.get(group[0].pieceId).label : `Building ${out.length + 1}`, group));
  }
  footprintsCache.set(pieces, out);
  const ms = ((globalThis as any).__bench_now_us ? Number((globalThis as any).__bench_now_us()) / 1000 : Date.now()) - t0;
  if (ms >= 16) console.warn(`[PLACEFREEZE] mapFootprints pieces=${pieces.length} groups=${out.length} ms=${ms.toFixed(2)}`);
  return out;
}

function footprintFromGroup(id: string, label: string, group: readonly PlacedBuildPiece[]): MapBuildFootprint {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const piece of group) {
    const b = GAME_BUILD.placed.bounds(piece);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  const center = buildWorldToGraph((minX + maxX) / 2, (minZ + maxZ) / 2);
  return {
    id,
    label,
    gx: center.gx,
    gy: center.gy,
    footW: Math.max(1, maxX - minX),
    footD: Math.max(1, maxZ - minZ),
    color: BUILDING_SWATCH,
    pieceIds: group.map((piece) => piece.id).sort(),
  };
}
