// world/pieceSlots.ts — a build piece's MATERIAL SLOTS, derived from its kind
// (req_2563 Phase 4). The "texture slots" the user asked for: named surfaces on
// a piece that each hold a MaterialRef (piece.slots[role]).
//
// The role table is pared to the surfaces each kind actually exposes.
// Walls/verticals read front+back; plates read a single
// top; posts/signs a single surface. Per-face granularity (every one of a box's
// six faces) is a later extension — this is the meaningful minimum that lets a
// placed piece carry per-instance material assignments today.
import { catalogRowFor } from './buildCatalog';
import type { BuildKind } from './buildCatalog';
import type { FaceSlot } from './pieceShapes';
import type { MaterialRef, PlacedPiece } from './pieces';
import { authoredPieceFor } from './authoredRegistry';
import { modelPackageById } from '../data/content';

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
 *  non-catalog id). (The Phase-4 "primary slot tints the whole live box" rule
 *  is gone — req_2886: overlay colours resolve per-box via slotRefForBox.) */
export type PieceSlotRole = { id: string; label: string };

/** Stable storage ids plus their author-facing labels. Catalog pieces use the
 * semantic id as their label; authored models may rename labels without moving
 * any saved per-placement `piece.slots[id]` binding. */
export function pieceSlotEntries(pieceId: string): PieceSlotRole[] {
  const authored = authoredPieceFor(pieceId);
  if (authored) return (modelPackageById(authored.pkgId)?.textureSlots ?? authored.textureSlots ?? []).map((slot) => ({ ...slot }));
  const row = catalogRowFor(pieceId);
  return row ? (SLOTS_BY_KIND[row.kind] ?? ['surface']).map((id) => ({ id, label: id })) : [];
}

export function pieceSlotRoles(pieceId: string): string[] {
  return pieceSlotEntries(pieceId).map((slot) => slot.id);
}

/** The material governing a decomposition box: the piece's slot for that box's
 *  face role. Chains are ROLE-EXPLICIT (req_2745): a plate's bottom sliver is
 *  tagged 'back' and its core 'sides', so those boxes read the plate role names
 *  (bottom/edges) too. A single-body piece's one slot (surface/face) covers
 *  every box. The old cross-face tails (back ← front ← top …) are gone — they
 *  made a targeted "just the top" assignment bleed onto every face, which is
 *  exactly what face targeting rules out. Shared by the skin renderer
 *  (pieceSkins) AND the flat live-overlay colours (pieces.pieceInstanceRows) so
 *  a painted face lands on the same slab in both looks (req_2886). */
export function slotRefForBox(piece: PlacedPiece, boxSlot: FaceSlot | undefined): MaterialRef | undefined {
  const s = piece.slots;
  if (!s) return undefined;
  const any = s.surface ?? s.face;
  switch (boxSlot) {
    case 'back': return s.back ?? s.bottom ?? any;
    case 'sides': return s.sides ?? s.edges ?? any;
    case 'top': return s.top ?? any;
    case 'front':
    default: return s.front ?? any;
  }
}

const DEG = Math.PI / 180;

/** The slot role under a host-raycast hit (req_2879 — the Paint Faces tool):
 *  the piece face the ray entered, named as the role `piece.slots` keys on, so
 *  painting what you TOUCHED updates exactly the slab the skin renderer draws.
 *
 *  `normal` is the TRUE outward world-space face normal __game_build_raycast
 *  returns (framework/game/build.zig raycastPieces — stickerLocalFrom is the
 *  long-proven inverse of the same frame). Un-rotating it by the transpose of
 *  pieceShapes' localOffset recovers the piece-local frame exactly, at ANY yaw
 *  including free angles — front/back are piece-fixed (req_3567; the old
 *  wrong-sign recovery here was what the pieceShapes odd-quarter tag swap
 *  compensated for). Null = the piece exposes no slots (a catalog piece with
 *  no roles, or an authored prop before face rigging) so there is nothing to
 *  paint. Multi-role authored meshes use the explicit right-click role menu
 *  because their current raycast is bounds-only. */
export function faceRoleForHit(
  pieceId: string,
  yawDegrees: number,
  normal: { x: number; y: number; z: number },
): string | null {
  const roles = pieceSlotRoles(pieceId);
  if (roles.length === 0) return null;
  // Authored meshes currently raycast by their placement bounds, not a triangle
  // id. The right-click menu can name every rigged role, but a viewport stroke
  // must not guess which polygon an AABB normal meant.
  if (authoredPieceFor(pieceId)) return roles.length === 1 ? roles[0]! : null;
  if (roles.length === 1) return roles[0]!;
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  const lu = normal.x * cos - normal.z * sin; // local width axis
  const lv = normal.x * sin + normal.z * cos; // local depth axis (+ = semantic front)
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
