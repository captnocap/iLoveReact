// void/distance.ts — escape_depth, the ONE scalar the void hangs off.
//
// THE LAW (SKYBOX_PLAYBOOK, USER req_1104): "Outward travel stretches space.
// Inward travel folds it." This module owns the OUTWARD axis: how far past the
// believable core the player has driven. Seam 1 reads REAL distance from the
// authored map center (the treadmill, seam 2, later swaps this for a virtual
// accumulator while clamping true position — same scalar, faked source).
//
// One source of truth (playbook discipline #2): every consumer reads
// escapeDepth; nobody hardcodes a km threshold. The believability-decay
// (voidDistortion, distortion.ts) is a pure function of this number.

import type { WorldState } from '../../design';

// The believable core: its center in world meters and the radius within which
// the world is "honest" (no decay). Beyond safeRadius, escape_depth climbs.
export type WorldCore = {
  centerX: number;
  centerZ: number;
  safeRadius: number;
};

// A small ring of grace outside the authored rectangle's circumradius, so the
// player can reach the very edge of the hand-built city before ANY decay reads.
// The void is what's BEYOND the authored work, never on top of it.
const SAFE_RADIUS_MARGIN_METERS = 60;

// Derive the core from the authored map's own bounds. The layout's
// widthCells × depthCells × cellSizeMeters is the authored extent; the center is
// its middle, and safeRadius is its circumradius (half-diagonal) plus a margin —
// the circumradius (not the inscribed radius) so the rectangle's CORNERS are
// still inside the safe zone and never decay.
export function worldCore(world: WorldState): WorldCore {
  const cell = world.cellSizeMeters;
  const widthMeters = world.layout.widthCells * cell;
  const depthMeters = world.layout.depthCells * cell;
  const halfDiagonal = Math.hypot(widthMeters, depthMeters) / 2;
  return {
    centerX: widthMeters / 2,
    centerZ: depthMeters / 2,
    safeRadius: halfDiagonal + SAFE_RADIUS_MARGIN_METERS,
  };
}

// Straight-line distance from the core center, in meters. The shell streamer and
// the depth share this so "is this chunk in the void" and "how deep am I" agree.
export function distanceFromCore(x: number, z: number, core: WorldCore): number {
  return Math.hypot(x - core.centerX, z - core.centerZ);
}

// escape_depth = max(0, distance_from_core - safe_radius). Zero everywhere inside
// the believable city; climbs linearly with how far OUT the player has driven.
// Meters; consumers that think in km divide by 1000.
export function escapeDepth(x: number, z: number, core: WorldCore): number {
  return Math.max(0, distanceFromCore(x, z, core) - core.safeRadius);
}
