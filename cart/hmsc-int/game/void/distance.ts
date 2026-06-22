// void/distance.ts — escape_depth, the ONE scalar the void hangs off.
//
// THE LAW (SKYBOX_PLAYBOOK, USER req_1104): "Outward travel stretches space.
// Inward travel folds it." This module owns the OUTWARD axis: how far past the
// believable core the player has driven. Seam 1 reads REAL distance OUTSIDE the
// authored map rectangle (the treadmill, seam 2, later swaps this for a virtual
// accumulator while clamping true position — same scalar, faked source).
//
// The "core" is the authored map RECTANGLE, not a circle. An earlier circle
// (circumradius) was wrong: a circle that encloses the rectangle's corners also
// encloses a huge margin beyond every edge, so the void never started until you
// were far past where you could stand — the shell was invisible. Distance is
// measured to the rectangle: zero inside the authored city, growing the moment
// you cross any edge.
//
// One source of truth (playbook discipline #2): every consumer reads escapeDepth
// / the core rectangle; nobody hardcodes a km threshold.

import type { WorldState } from '../../design';

// The believable core: the authored map's world-space rectangle (meters) plus
// its center (used for the streaming focus / framing).
export type WorldCore = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
};

// A grace ring just outside the authored edge before ANY decay reads, so the
// very rim of the hand-built city is still honest.
const SAFE_MARGIN_METERS = 40;

// Derive the core rectangle from the authored map's own bounds. The layout's
// widthCells × depthCells × cellSizeMeters is the authored extent; cells start at
// the world origin, so the rectangle is [0,width] × [0,depth].
export function worldCore(world: WorldState): WorldCore {
  const cell = world.cellSizeMeters;
  const maxX = world.layout.widthCells * cell;
  const maxZ = world.layout.depthCells * cell;
  return { minX: 0, minZ: 0, maxX, maxZ, centerX: maxX / 2, centerZ: maxZ / 2 };
}

// Euclidean distance from a point to the authored rectangle, in meters. Zero
// anywhere inside the rectangle; the straight-line gap to the nearest edge/corner
// outside it. This is what "how far past the believable city am I" means.
export function distanceOutsideCore(x: number, z: number, core: WorldCore): number {
  const dx = Math.max(core.minX - x, 0, x - core.maxX);
  const dz = Math.max(core.minZ - z, 0, z - core.maxZ);
  return Math.hypot(dx, dz);
}

// escape_depth = max(0, distanceOutsideCore - margin). Zero everywhere inside the
// believable city (and its grace rim); climbs with how far OUT past the edge the
// player has driven. Meters; consumers that think in km divide by 1000.
export function escapeDepth(x: number, z: number, core: WorldCore): number {
  return Math.max(0, distanceOutsideCore(x, z, core) - SAFE_MARGIN_METERS);
}
