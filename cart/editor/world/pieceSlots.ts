// world/pieceSlots.ts — a build piece's MATERIAL SLOTS, derived from its kind
// (req_2563 Phase 4). The "texture slots" the user asked for: named surfaces on
// a piece that each hold a MaterialRef (piece.slots[role]).
//
// Cloned in spirit from the last editor's face-slot model (hmsc-int
// buildingEditor.ts FACE_ROLES / BuildingFaceSkins) but pared to the roles the
// kind actually exposes. Walls/verticals read front+back; plates read a single
// top; posts/signs a single surface. Per-face granularity (every one of a box's
// six faces) is a later extension — this is the meaningful minimum that lets a
// placed piece carry per-instance material assignments today.
import { catalogRowFor } from './buildCatalog';
import type { BuildKind } from './buildCatalog';

// Role sets mirror what the piece's decomposition can actually WEAR (pieceShapes
// tags every box with a FaceSlot; pieceSkins maps role → box). Plates carry the
// hmsc three-face model (req_2745: top/bottom/edges — a floor placed as a ceiling
// paints its underside); the wall family adds 'sides' for the core/end caps. A
// single-body piece (pillar/corner/trim) exposes the one surface it really has.
const SLOTS_BY_KIND: Record<BuildKind, string[]> = {
  wall: ['front', 'back', 'sides'],
  floor: ['top', 'bottom', 'edges'],
  roof: ['top', 'bottom', 'edges'],
  ramp: ['surface'],
  stairs: ['surface'],
  elevator: ['surface'],
  pillar: ['surface'],
  corner: ['surface'],
  arch: ['front', 'back', 'sides'],
  fence: ['front', 'back', 'sides'],
  railing: ['front', 'back', 'sides'],
  trim: ['surface'],
  sign: ['face'],
};

/** The material-slot roles a piece exposes, from its catalog kind (empty for a
 *  non-catalog id). The FIRST role is the piece's PRIMARY slot — the one whose
 *  assigned material tints the live-overlay box (Phase 4). */
export function pieceSlotRoles(pieceId: string): string[] {
  const row = catalogRowFor(pieceId);
  return row ? SLOTS_BY_KIND[row.kind] ?? ['surface'] : [];
}

/** The primary slot role (drives the overlay tint), or null if the piece has none. */
export function primarySlotRole(pieceId: string): string | null {
  return pieceSlotRoles(pieceId)[0] ?? null;
}

const DEG = Math.PI / 180;

/** The slot role under a host-raycast hit (req_2879 — the Paint Faces tool):
 *  the piece face the ray entered, named as the role `piece.slots` keys on, so
 *  painting what you TOUCHED updates exactly the slab the skin renderer draws.
 *
 *  `normal` is the outward world-space face normal __game_build_raycast returns
 *  (framework/game/build.zig raycastPieces). Rotating it back by -yaw recovers
 *  the HOST's piece-local frame — which is also the semantic frame: at odd
 *  quarter turns the host's local +z lands on the slab pieceShapes tags 'back'
 *  (the same swap its frontSlot/backSlot carries), so no extra swap here.
 *  Quarter-turn placements only (the piece grammar's rotation step); a free-yaw
 *  piece would mis-classify u/v, not crash. Null = the piece exposes no slots
 *  (non-catalog ids — authored/prop meshes) so there is nothing to paint. */
export function faceRoleForHit(
  pieceId: string,
  yawDegrees: number,
  normal: { x: number; y: number; z: number },
): string | null {
  const roles = pieceSlotRoles(pieceId);
  if (roles.length === 0) return null;
  if (roles.length === 1) return roles[0]!;
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  const lu = normal.x * cos + normal.z * sin; // local width axis
  const lv = -normal.x * sin + normal.z * cos; // local depth axis (+ = semantic front)
  const ly = normal.y;
  if (roles[0] === 'top') {
    // Plate family (floor/roof): top / bottom / edges.
    return Math.abs(ly) >= Math.max(Math.abs(lu), Math.abs(lv))
      ? (ly > 0 ? 'top' : 'bottom')
      : 'edges';
  }
  // Wall family (wall/arch/fence/railing): front / back / sides — the width
  // ends and the top/bottom rim are all the core box, which wears 'sides'.
  return Math.abs(lv) > Math.max(Math.abs(lu), Math.abs(ly))
    ? (lv > 0 ? 'front' : 'back')
    : 'sides';
}
