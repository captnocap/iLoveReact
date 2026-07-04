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

const SLOTS_BY_KIND: Record<BuildKind, string[]> = {
  wall: ['front', 'back'],
  floor: ['top'],
  roof: ['top'],
  ramp: ['surface'],
  stairs: ['surface'],
  elevator: ['surface'],
  pillar: ['surface'],
  corner: ['front', 'back'],
  arch: ['front', 'back'],
  fence: ['front', 'back'],
  railing: ['front', 'back'],
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
