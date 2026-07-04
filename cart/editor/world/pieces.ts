// world/pieces.ts — the editor's OWN placed-piece model (req_2486: the last
// hmsc-int cross-import dies). This is deliberately the MINIMAL vocabulary the
// editor's world surface actually exercises today — grid-snapped plates placed
// live — not a clone of the hmsc build brain (which is welded to the 435-file
// prop-recipe science project and dies with its cart).
//
// The heavy placement math already lives HOST-SIDE (framework/game/build.zig,
// req_2349 — placementFor/validatePlacement/raycastPieces); the editor calls it
// through runtime/game/build.ts. What this file keeps JS-side is presentation
// glue only: the tiny piece list, the live-overlay row packing (the
// world_loader 12-float unit-box row), and the sizes/colors of the few pieces
// the palette arms. When the full catalog-rows door lands on
// v8_bindings_game_build.zig, PIECE_LOOKS collapses into a host readback.

import { buildCatalogIndex, validateBuildPlacement } from '@reactjit/runtime/game/build';
import { METERS_PER_LEVEL } from './isoStage';

export type PlacedPiece = {
  id: string;
  pieceId: string;
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
};

export type ArmedPiece = { pieceId: string } | null;

/** Size + tint for the pieces the editor arms, verbatim from the hmsc catalog
 *  rows (FLOOR_SIZE / WALL_SIZE + MATERIAL_LOOK concrete) so a placement looks
 *  identical to what the old surface rendered. Grows with the palette. */
export const PIECE_LOOKS: Record<string, { w: number; h: number; d: number; rgb: [number, number, number]; label: string }> = {
  'floor.concrete.common': { w: 3, h: 0.05, d: 3, rgb: rgbOf('#9aa3ad'), label: 'Concrete Floor' },
  'wall.concrete.common': { w: 3, h: 3, d: 0.005, rgb: rgbOf('#9aa3ad'), label: 'Concrete Wall' },
};

/** The grid module placements snap to (the catalog's 3m piece module). */
export const PIECE_MODULE_METERS = 3;

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Snap a ground point to the module grid: the CENTER of the 3m cell under it. */
export function snapToModule(v: number): number {
  return Math.floor(v / PIECE_MODULE_METERS) * PIECE_MODULE_METERS + PIECE_MODULE_METERS / 2;
}

/** Resolve a click into a placement for the armed piece on the active level.
 *  Grid-snap only — the vocabulary the surface arms today (plates). Wall
 *  edge-snap arrives with the placement-resolve door. Returns null when the
 *  HOST validator rejects (validateBuildPlacement, framework/game/build.zig). */
export function resolvePlacement(pieceId: string, wx: number, wz: number, levelY: number): PlacedPiece | null {
  const catalogIndex = buildCatalogIndex(pieceId);
  const x = snapToModule(wx);
  const z = snapToModule(wz);
  if (catalogIndex >= 0) {
    const v = validateBuildPlacement(catalogIndex, x, levelY, z, 0);
    if (!v.valid) return null;
  }
  return { id: '', pieceId, x, y: levelY, z, yawDegrees: 0 };
}

/** The storey a placed piece belongs to (its base Y in level units). */
export function pieceFloorOf(piece: PlacedPiece): number {
  return Math.round(piece.y / METERS_PER_LEVEL);
}

/** A wall-kind piece (piece ids are kind-dotted: 'wall.concrete.common'). */
export function isWallPiece(pieceId: string): boolean {
  return pieceId.startsWith('wall.');
}

/** Sims-style storey cutaway (req_2567): everything ABOVE the active floor is
 *  hidden so the storey you're editing is never buried under its own building,
 *  and `wallsDown` additionally hides the ACTIVE floor's walls (interior /
 *  prop-placement view). Floors below always show — they're the context. */
export function visibleStoreyPieces(pieces: readonly PlacedPiece[], floor: number, wallsDown: boolean): PlacedPiece[] {
  return pieces.filter((piece) => {
    const storey = pieceFloorOf(piece);
    if (storey > floor) return false;
    if (wallsDown && storey === floor && isWallPiece(piece.pieceId)) return false;
    return true;
  });
}

/** Pack placed pieces into the world_loader live-overlay rows — 12 floats each
 *  (cx,cy,cz, 0,yawDeg,0, sx,sy,sz, r,g,b), the same unit-box layout the bake
 *  emits (LIVEHOST req_1798). Unknown pieceIds are skipped LOUDLY. */
export function pieceRows(pieces: readonly PlacedPiece[]): Float32Array {
  const rows: number[] = [];
  for (const piece of pieces) {
    const look = PIECE_LOOKS[piece.pieceId];
    if (!look) {
      console.warn(`[world] no look for piece '${piece.pieceId}' — not rendered live`);
      continue;
    }
    rows.push(
      piece.x, piece.y + look.h / 2, piece.z,
      0, piece.yawDegrees, 0,
      look.w, look.h, look.d,
      look.rgb[0], look.rgb[1], look.rgb[2],
    );
  }
  return new Float32Array(rows);
}
