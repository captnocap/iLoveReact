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
import { landformKindDefinition } from '../kinds';

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

// Derive the core rectangle from the authored map's ACTUAL extent — the bounding
// box of all surfaceRegions AND landforms — not from the static layout dimensions
// (which are the initial 2×2 chunk template and don't grow as the user paints).
//
// The painted ground is the load-bearing case: a painted chunk is NOT a
// surfaceRegion, it is a `heightfield` landform (chunkFloor.floorToLandform — one
// per chunk, the editor's previewWorld.landforms and the compiled floor-merged
// world both carry them). Reading only surfaceRegions left the core stuck at the
// 2×2 template, so the void shell drew its procedural city right over chunks the
// user had painted. Expanding over every landform's footprint (via the registry's
// footprintRadius — the SAME extent the terrain/collider passes use) makes the
// core grow with the painted map.
export function worldCore(world: WorldState): WorldCore {
  const cell = world.cellSizeMeters;
  // Start with the layout's nominal bounds as a floor, then expand to cover all
  // painted surfaceRegions and landforms.
  let minX = 0;
  let minZ = 0;
  let maxX = world.layout.widthCells * cell;
  let maxZ = world.layout.depthCells * cell;
  for (const r of world.surfaceRegions ?? []) {
    const rx = r.x * cell;
    const rz = r.z * cell;
    const rw = r.width * cell;
    const rd = r.depth * cell;
    minX = Math.min(minX, rx);
    minZ = Math.min(minZ, rz);
    maxX = Math.max(maxX, rx + rw);
    maxZ = Math.max(maxZ, rz + rd);
  }
  // Painted chunks (and mountains/hills/estates) are landforms, not regions. Each
  // covers a square of ±footprintRadius about its centre — for a painted chunk the
  // inscribed half-extent is exactly half a chunk, so the union is the painted area.
  for (const lf of world.landforms ?? []) {
    const def = landformKindDefinition(lf.kind);
    if (!def) continue;
    const r = def.footprintRadius(lf.params, lf.field);
    if (!(r > 0)) continue;
    minX = Math.min(minX, lf.centerX - r);
    minZ = Math.min(minZ, lf.centerZ - r);
    maxX = Math.max(maxX, lf.centerX + r);
    maxZ = Math.max(maxZ, lf.centerZ + r);
  }
  return { minX, minZ, maxX, maxZ, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
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

// True when a point is inside the authored rectangle. The shell uses this to
// decide what to skip: a chunk whose CENTER is inside is skipped (the void never
// centres on the authored map), and a building whose centre is inside is skipped
// (no procedural tower pokes up through the authored city) — while a boundary
// chunk's GROUND still fills right up to the edge, so there is no gap.
export function pointInCore(x: number, z: number, core: WorldCore): boolean {
  return x >= core.minX && x <= core.maxX && z >= core.minZ && z <= core.maxZ;
}
