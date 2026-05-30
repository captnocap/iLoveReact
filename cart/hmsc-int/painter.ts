import { hmscStoreGet, hmscStoreSet } from '../hmsc/state/gameState';
import { placeableById } from '../hmsc/world/placeables';

// Pure painter logic for the hmsc-int chunk painter: cell-key helpers, greedy
// rectangle decomposition + command emission (the copy-pasta), and draft/backup
// persistence. No React, no UI — index.tsx owns state + rendering.

export type PaintedZone = { x: number; z: number; width: number; depth: number; name: string; flags: string[] };

// The full painter buffer at a point in time. `painted` maps "x,z" -> placeableId
// (cell-paint layers, e.g. 'tile:sand'); `zones` are rect-paint entries.
export type PainterSnapshot = { painted: [string, string][]; zones: PaintedZone[] };
export type PainterBackup = { at: string; snapshot: PainterSnapshot };

const DRAFT_KEY = 'chunkPainter.draft';
const HISTORY_KEY = 'chunkPainter.history';
const HISTORY_CAP = 100;

export function cellKeyOf(x: number, z: number): string {
  return `${x},${z}`;
}

export function parseCellKey(key: string): { x: number; z: number } {
  const comma = key.indexOf(',');
  return { x: Number(key.slice(0, comma)), z: Number(key.slice(comma + 1)) };
}

export function snapshotOf(painted: Map<string, string>, zones: PaintedZone[]): PainterSnapshot {
  return { painted: [...painted.entries()], zones: zones.map((z) => ({ ...z, flags: [...z.flags] })) };
}

export function restoreSnapshot(snap: PainterSnapshot): { painted: Map<string, string>; zones: PaintedZone[] } {
  return {
    painted: new Map(snap.painted),
    zones: (snap.zones ?? []).map((z) => ({ ...z, flags: [...(z.flags ?? [])] })),
  };
}

function parseSnapshot(raw: string | null): PainterSnapshot | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.painted)) return null;
    return { painted: obj.painted, zones: Array.isArray(obj.zones) ? obj.zones : [] };
  } catch {
    return null;
  }
}

export function saveDraft(snap: PainterSnapshot): void {
  hmscStoreSet(DRAFT_KEY, JSON.stringify(snap));
}

export function loadDraft(): PainterSnapshot | null {
  return parseSnapshot(hmscStoreGet(DRAFT_KEY));
}

export function loadBackups(): PainterBackup[] {
  const raw = hmscStoreGet(HISTORY_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((b) => b && b.snapshot && Array.isArray(b.snapshot.painted)) : [];
  } catch {
    return [];
  }
}

// Append a timestamped snapshot to the persisted ring (capped, oldest dropped)
// and return the new ring. Called on every committed stroke — restore is never
// limited to sequential undo.
export function appendBackup(snap: PainterSnapshot): PainterBackup[] {
  const ring = loadBackups();
  ring.push({ at: new Date().toISOString(), snapshot: snap });
  while (ring.length > HISTORY_CAP) ring.shift();
  hmscStoreSet(HISTORY_KEY, JSON.stringify(ring));
  return ring;
}

type Rect = { x: number; z: number; width: number; depth: number; id: string };

// Greedy maximal-rectangle decomposition of the painted cells: visit row-major,
// grow each uncovered cell's run along +x (same id), then grow height while the
// full-width row matches, mark covered, emit one rect. Solid areas collapse to a
// single rect; only painted cells are ever covered (unpainted gaps stay empty).
function greedyRects(painted: Map<string, string>): Rect[] {
  if (painted.size === 0) return [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const key of painted.keys()) {
    const { x, z } = parseCellKey(key);
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  const covered = new Set<string>();
  const rects: Rect[] = [];
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const key = cellKeyOf(x, z);
      if (covered.has(key)) continue;
      const id = painted.get(key);
      if (id == null) continue;
      let width = 1;
      while (x + width <= maxX) {
        const k = cellKeyOf(x + width, z);
        if (painted.get(k) !== id || covered.has(k)) break;
        width += 1;
      }
      let depth = 1;
      growHeight: while (true) {
        const nz = z + depth;
        if (nz > maxZ) break;
        for (let xx = x; xx < x + width; xx += 1) {
          const k = cellKeyOf(xx, nz);
          if (painted.get(k) !== id || covered.has(k)) break growHeight;
        }
        depth += 1;
      }
      for (let zz = z; zz < z + depth; zz += 1) {
        for (let xx = x; xx < x + width; xx += 1) covered.add(cellKeyOf(xx, zz));
      }
      rects.push({ x, z, width, depth, id });
    }
  }
  return rects;
}

export type PaintedTileRect = { x: number; z: number; width: number; depth: number; kind: string };

// Painted cells decomposed into rectangles with their resolved tile kind — for
// LIVE map rendering (pushed as shader regions so the paint shows through the
// same raster the world uses). Zone rects render as overlays, handled separately.
export function paintedTileRects(painted: Map<string, string>): PaintedTileRect[] {
  return greedyRects(painted).flatMap((rect) => {
    const placeable = placeableById(rect.id);
    if (!placeable || placeable.layer !== 'tile') return [];
    return [{ x: rect.x, z: rect.z, width: rect.width, depth: rect.depth, kind: placeable.kind }];
  });
}

// The copy-pasta: each painted rectangle and zone becomes its layer's command
// (via the Placeable registry's emit, so command form lives in ONE place).
export function emitChunkCommands(painted: Map<string, string>, zones: PaintedZone[]): string {
  const lines: string[] = [];
  for (const rect of greedyRects(painted)) {
    const placeable = placeableById(rect.id);
    if (!placeable) continue;
    lines.push(...placeable.emit({ x: rect.x, z: rect.z, width: rect.width, depth: rect.depth }));
  }
  const zonePlaceable = placeableById('zone');
  if (zonePlaceable) {
    for (const zone of zones) {
      lines.push(...zonePlaceable.emit({ x: zone.x, z: zone.z, width: zone.width, depth: zone.depth, name: zone.name, flags: zone.flags }));
    }
  }
  return lines.join('\n');
}
