// world/pieceFieldStep.ts — one focus-panel stepper press resolved against the
// LIVE piece (req_3449).
//
// The panel's [−]/[+] controls must not compute their result in the UI: the
// renderer registers a Pressable's onPress at commit time and re-registers only
// when clean (visual) props change, so a handler that bakes in the piece id or
// the displayed value acts on the FIRST render's snapshot forever (the
// documented Pressable-stale-closure trap — the req_3449 Copy button armed a
// long-gone piece this way). A press therefore carries only (field, direction);
// this helper derives the step size, clamp, and result from the piece AppFrame
// reads out of live state at click time.
import {
  PIECE_MODULE_METERS,
  PIECE_SCALE_LIMITS,
  pieceFloorOf,
  pieceKindOf,
  pieceScaleOf,
  type PlacedPiece,
} from './pieces';
import { WORLD_PIECE_EDIT_LIMITS } from './pieceEditCommand';
import { METERS_PER_LEVEL } from './isoStage';
import { isAuthoredPiece } from './authoredRegistry';

export type PieceStepField = 'x' | 'z' | 'height' | 'floor' | 'yaw' | 'scale' | 'spin';

/** Free-placing props nudge finely; grid/edge pieces step the 3m module so
 *  every step stays on its snap family (cell centres stay centres, edge lines
 *  stay lines). */
export const PROP_POSITION_STEP_METERS = 0.1;
export const PROP_YAW_STEP_DEGREES = 15;
export const SPIN_STEP_DEG_PER_SEC = 15;
export const SPIN_LIMIT_DEG_PER_SEC = 180;
export const SCALE_STEP = 0.1;

export type PieceFieldStepResult =
  | { kind: 'move'; destination: PlacedPiece }
  | { kind: 'spin'; rate: number };

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The stepped piece for one panel press, or null when the field does not
 *  apply to this piece (e.g. `height`/`scale` on a grid piece — the panel
 *  never shows those rows, so a stale press on them must be inert too). */
export function stepPieceField(
  piece: PlacedPiece,
  field: PieceStepField,
  direction: -1 | 1,
): PieceFieldStepResult | null {
  const kind = pieceKindOf(piece.pieceId);
  const isProp = kind === 'prop';
  switch (field) {
    case 'x': {
      const step = isProp ? PROP_POSITION_STEP_METERS : PIECE_MODULE_METERS;
      return { kind: 'move', destination: { ...piece, x: round2(piece.x + direction * step) } };
    }
    case 'z': {
      const step = isProp ? PROP_POSITION_STEP_METERS : PIECE_MODULE_METERS;
      return { kind: 'move', destination: { ...piece, z: round2(piece.z + direction * step) } };
    }
    case 'height': {
      if (!isProp) return null;
      const maxHeight = WORLD_PIECE_EDIT_LIMITS.maxFloor * METERS_PER_LEVEL;
      const y = Math.max(0, Math.min(maxHeight, round2(piece.y + direction * PROP_POSITION_STEP_METERS)));
      return { kind: 'move', destination: { ...piece, y } };
    }
    case 'floor': {
      const current = pieceFloorOf(piece);
      const floor = Math.max(0, Math.min(WORLD_PIECE_EDIT_LIMITS.maxFloor, current + direction));
      if (floor === current) return null;
      return { kind: 'move', destination: { ...piece, floor, y: round2(piece.y + (floor - current) * METERS_PER_LEVEL) } };
    }
    case 'yaw': {
      // Free yaw is a prop capability; grid/edge pieces quarter-turn through the
      // rotate transaction (their footprint identity is quantised to 90°).
      if (!isProp) return null;
      const yaw = ((piece.yawDegrees + direction * PROP_YAW_STEP_DEGREES) % 360 + 360) % 360;
      return { kind: 'move', destination: { ...piece, yawDegrees: yaw } };
    }
    case 'scale': {
      if (!isProp) return null;
      const scale = Math.max(PIECE_SCALE_LIMITS.min, Math.min(PIECE_SCALE_LIMITS.max, round2(pieceScaleOf(piece) + direction * SCALE_STEP)));
      return { kind: 'move', destination: { ...piece, scale } };
    }
    case 'spin': {
      // Spin is drawn only for authored meshes (the live loader's yaw+rate×clock
      // path) — the panel shows the row only there; a stale press stays inert.
      if (!isAuthoredPiece(piece.pieceId)) return null;
      const rate = Math.max(-SPIN_LIMIT_DEG_PER_SEC, Math.min(SPIN_LIMIT_DEG_PER_SEC, (piece.spinDegPerSec ?? 0) + direction * SPIN_STEP_DEG_PER_SEC));
      return { kind: 'spin', rate };
    }
  }
}
