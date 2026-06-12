// editors/world/previewWorld.ts — the preview-world assembler (SHELLFOLD-0611,
// review §2 seam 4). A pure compiler from (base world, painted floors,
// placements, kind textures) → the GameState the iso pane, /test, and Compile
// all consume. No React, no editor state — the shell memoizes one call.
//
// Placement graph coords → world cells via placementCellRect — the ONE shared
// snap (the canvas node draws the same rect), so 2D, preview, and compile
// agree on every cell. Legacy `cat: building` placements are intentionally
// inert: AUTHBUILD-REMOVE deleted the old world.buildings system; V24 build
// pieces (`bp_*`) are the surviving building model.

import type { GameState } from '../../design';
import { placeMarker, placeWorldProp } from '../../editorWorld';
import { cellCenterToWorld, cellKey as gridCellKey } from '../../world/grid';
import { floorsToLandforms, type ChunkFloor } from '../../chunkFloor';
import { placementCellRect, type Placement } from '../../placements';

export function assemblePreviewWorld(opts: {
  baseWorld: GameState;
  floors: ChunkFloor[];
  placements: Placement[];
  /** global per-kind part textures folded with the instance override winning */
  mergeKindTextures: (cat: 'building' | 'prop', kind: string, inst?: Record<string, string>) => Record<string, string> | undefined;
}): GameState {
  const { baseWorld, floors, placements, mergeKindTextures } = opts;
  let s: GameState = { ...baseWorld, world: { ...baseWorld.world, landforms: floorsToLandforms(floors) } };
  // Markers are single cells; precompute every marker's cell up front so a
  // save can resolve the spawn it links to even if that spawn is placed later
  // in the list.
  const markerCellOf = new Map<string, { x: number; z: number }>();
  for (const p of placements) {
    if (p.cat !== 'marker') continue;
    const r = placementCellRect(p);
    markerCellOf.set(p.id, { x: r.minX, z: r.minZ });
  }
  const occupiedMarkerCells = new Set<string>();
  for (const p of placements) {
    const rect = placementCellRect(p);
    const wx = rect.minX;
    const wz = rect.minZ;
    if (p.cat === 'building') {
      continue;
    } else if (p.cat === 'marker') {
      // Spawn / save markers lower to single placedCells. ONE marker per cell —
      // a spawn can't sit on a save (the non-overlap rule), so the first to claim
      // a cell wins and any later marker on it is dropped.
      const key = gridCellKey({ x: wx, y: 0, z: wz });
      if (occupiedMarkerCells.has(key)) continue;
      occupiedMarkerCells.add(key);
      // A save links to its chosen spawn (manual pairing) — resolve that spawn's
      // cell to a key, but never to its own cell (a save never spawns you on top
      // of itself).
      let spawnKey: string | undefined;
      if (p.kind === 'save' && p.spawnId) {
        const sc = markerCellOf.get(p.spawnId);
        if (sc && !(sc.x === wx && sc.z === wz)) spawnKey = gridCellKey({ x: sc.x, y: 0, z: sc.z });
      }
      s = placeMarker(s, { kind: p.kind as 'spawn' | 'save' | 'vehicleSpawn', x: wx, z: wz, spawnKey });
    } else {
      // Props anchor at their CENTER (radial footprint) — the snapped rect's
      // centre, so the prop sits exactly where its canvas node draws.
      s = placeWorldProp(s, { kind: p.kind as Parameters<typeof placeWorldProp>[1]['kind'], x: wx + p.footW / 2, z: wz + p.footD / 2, yawDegrees: p.rotation, partTextures: mergeKindTextures('prop', p.kind, p.partTextures) }).state;
    }
  }
  // The world's default spawn — where a fresh game drops the player. The first
  // spawn marker wins; its cell becomes the player start AND the armed respawn,
  // so booting the compiled map puts you on that spawn.
  const firstSpawn = placements.find((p) => p.cat === 'marker' && p.kind === 'spawn');
  if (firstSpawn) {
    const c = markerCellOf.get(firstSpawn.id)!;
    const cell = { x: c.x, y: 0, z: c.z };
    const pos = cellCenterToWorld(cell, s.world.cellSizeMeters);
    s = { ...s, player: { ...s.player, position: { x: pos.x, y: s.player.position.y, z: pos.z }, respawnCell: cell } };
  }
  return s;
}
