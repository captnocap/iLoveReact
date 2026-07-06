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
