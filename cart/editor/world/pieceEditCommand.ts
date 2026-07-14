// Pure transaction boundary for authored world-piece edits.
//
// UI surfaces submit semantic transforms or an instance id. This module owns
// document/instance validation, destination replacement, and exact forward /
// inverse patches. React, menus, hotkeys, the viewport, and the eventbus all sit
// outside this boundary, so a headless peer executes the identical mutation.
import { applyPieceListPatch, type IndexedPiece, type PieceListPatch } from './piecePlacementCommand';
import { placementSlotKey, type PlacedPiece } from './pieces';
import {
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_EDIT_COMMAND_IDS,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  type WorldPieceEditCommandId,
} from './pieceCommandIds';
export {
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_EDIT_COMMAND_IDS,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
} from './pieceCommandIds';
export type { WorldPieceEditCommandId } from './pieceCommandIds';
export type WorldPieceEditAction = 'move' | 'rotate' | 'delete';

export const WORLD_PIECE_EDIT_LIMITS = Object.freeze({ maxFloor: 128 });

export type PieceTransform = Pick<PlacedPiece, 'x' | 'y' | 'z' | 'yawDegrees'> & { floor: number };
export type PieceMoveArgs = { documentId: string; pieceId: string; transform: PieceTransform };
export type PieceRotateArgs = { documentId: string; pieceId: string; quarterTurns: -1 | 1 };
export type PieceDeleteArgs = { documentId: string; pieceId: string };

export type PieceEditWorld = {
  documentId: string;
  pieces: readonly PlacedPiece[];
  selectedPieceId: string | null;
};

export type PieceEditTransaction = {
  commandId: WorldPieceEditCommandId;
  documentId: string;
  action: WorldPieceEditAction;
  before: IndexedPiece;
  after: PlacedPiece | null;
  /** Move may evict pieces which already own the destination footprint. */
  replaced: readonly IndexedPiece[];
  forward: PieceListPatch;
  inverse: PieceListPatch;
};

export type PieceEditPlan = {
  transaction: PieceEditTransaction;
  next: PieceEditWorld;
};

export type PieceEditRejectCode =
  | 'wrong-document'
  | 'invalid-world'
  | 'invalid-args'
  | 'missing-piece'
  | 'no-change'
  | 'stale-patch';

export class PieceEditRejected extends Error {
  readonly code: PieceEditRejectCode;

  constructor(code: PieceEditRejectCode, message: string) {
    super(message);
    this.name = 'PieceEditRejected';
    this.code = code;
  }
}

function reject(code: PieceEditRejectCode, message: string): never {
  throw new PieceEditRejected(code, message);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clonePiece(piece: PlacedPiece): PlacedPiece {
  return {
    ...piece,
    ...(piece.slots ? {
      slots: Object.fromEntries(Object.entries(piece.slots).map(([role, ref]) => [
        role,
        'assetId' in ref ? { assetId: ref.assetId } : { fn: ref.fn, variant: ref.variant },
      ])),
    } : {}),
    ...(piece.overrides ? { overrides: { ...piece.overrides } } : {}),
    ...(piece.stickers ? { stickers: piece.stickers.map((sticker) => ({ ...sticker })) } : {}),
  };
}

function validateWorld(world: PieceEditWorld, documentId: string, pieceId: string): IndexedPiece {
  if (!world.documentId) reject('invalid-world', 'world edit adapter supplied no document identity');
  if (documentId !== world.documentId) {
    reject('wrong-document', `piece edit targets '${documentId}', but '${world.documentId}' is active`);
  }
  if (!pieceId) reject('invalid-args', 'pieceId is required');
  const ids = new Set<string>();
  let found: IndexedPiece | null = null;
  for (let index = 0; index < world.pieces.length; index += 1) {
    const piece = world.pieces[index]!;
    if (!piece.id || ids.has(piece.id)) reject('invalid-world', `world contains duplicate/empty piece id '${piece.id}'`);
    if (!piece.pieceId || ![piece.x, piece.y, piece.z, piece.yawDegrees].every(finite) ||
        (piece.floor !== undefined && (!Number.isInteger(piece.floor) || piece.floor < 0 || piece.floor > WORLD_PIECE_EDIT_LIMITS.maxFloor))) {
      reject('invalid-world', `world piece '${piece.id}' has invalid semantic identity or transform`);
    }
    ids.add(piece.id);
    if (piece.id === pieceId) found = { index, piece: clonePiece(piece) };
  }
  if (!found) reject('missing-piece', `piece '${pieceId}' is not present in '${documentId}'`);
  return found;
}

function applyPatch(world: PieceEditWorld, transaction: PieceEditTransaction, patch: PieceListPatch): PieceEditWorld {
  if (world.documentId !== transaction.documentId) {
    reject('wrong-document', `piece edit belongs to '${transaction.documentId}', not '${world.documentId}'`);
  }
  try {
    return {
      ...world,
      pieces: applyPieceListPatch(world.pieces, patch),
      selectedPieceId: patch.selectedPieceId,
    };
  } catch (error) {
    reject('stale-patch', error instanceof Error ? error.message : String(error));
  }
}

export function applyPieceEditForward(world: PieceEditWorld, transaction: PieceEditTransaction): PieceEditWorld {
  return applyPatch(world, transaction, transaction.forward);
}

export function applyPieceEditInverse(world: PieceEditWorld, transaction: PieceEditTransaction): PieceEditWorld {
  return applyPatch(world, transaction, transaction.inverse);
}

function finish(
  world: PieceEditWorld,
  commandId: WorldPieceEditCommandId,
  action: WorldPieceEditAction,
  before: IndexedPiece,
  after: PlacedPiece | null,
  replaced: readonly IndexedPiece[],
  forward: PieceListPatch,
  inverse: PieceListPatch,
): PieceEditPlan {
  const transaction: PieceEditTransaction = {
    commandId,
    documentId: world.documentId,
    action,
    before,
    after,
    replaced,
    forward,
    inverse,
  };
  return { transaction, next: applyPieceEditForward(world, transaction) };
}

export function planPieceMove(world: PieceEditWorld, args: PieceMoveArgs): PieceEditPlan {
  const before = validateWorld(world, args.documentId, args.pieceId);
  const transform = args.transform;
  if (!transform || ![transform.x, transform.y, transform.z, transform.yawDegrees].every(finite) ||
      !Number.isInteger(transform.floor) || transform.floor < 0 || transform.floor > WORLD_PIECE_EDIT_LIMITS.maxFloor) {
    reject('invalid-args', `move transform must be finite and floor must be an integer from 0 to ${WORLD_PIECE_EDIT_LIMITS.maxFloor}`);
  }
  const after = clonePiece({ ...before.piece, ...transform });
  if (before.piece.x === after.x && before.piece.y === after.y && before.piece.z === after.z &&
      before.piece.yawDegrees === after.yawDegrees && before.piece.floor === after.floor) {
    reject('no-change', `piece '${args.pieceId}' already has that transform`);
  }
  const destination = placementSlotKey(after);
  const replaced: IndexedPiece[] = [];
  for (let index = 0; index < world.pieces.length; index += 1) {
    const piece = world.pieces[index]!;
    if (piece.id !== args.pieceId && placementSlotKey(piece) === destination) {
      replaced.push({ index, piece: clonePiece(piece) });
    }
  }
  return finish(
    world,
    WORLD_PIECE_MOVE_COMMAND_ID,
    'move',
    before,
    after,
    replaced,
    {
      removeIds: [before.piece.id, ...replaced.map((row) => row.piece.id)],
      insert: [],
      append: [after],
      selectedPieceId: after.id,
    },
    {
      removeIds: [after.id],
      insert: [before, ...replaced],
      append: [],
      selectedPieceId: world.selectedPieceId,
    },
  );
}

export function planPieceRotate(world: PieceEditWorld, args: PieceRotateArgs): PieceEditPlan {
  const before = validateWorld(world, args.documentId, args.pieceId);
  if (args.quarterTurns !== -1 && args.quarterTurns !== 1) {
    reject('invalid-args', 'quarterTurns must be exactly -1 or 1');
  }
  const yawDegrees = ((before.piece.yawDegrees + args.quarterTurns * 90) % 360 + 360) % 360;
  const after = clonePiece({ ...before.piece, yawDegrees });
  const destination = placementSlotKey(after);
  const replaced: IndexedPiece[] = [];
  for (let index = 0; index < world.pieces.length; index += 1) {
    const piece = world.pieces[index]!;
    if (piece.id !== args.pieceId && placementSlotKey(piece) === destination) {
      replaced.push({ index, piece: clonePiece(piece) });
    }
  }
  // Preserve the rotating row's list position after destination victims have
  // been removed; moving it to the end would create ordering churn on every R.
  const forwardIndex = before.index - replaced.filter((row) => row.index < before.index).length;
  return finish(
    world,
    WORLD_PIECE_ROTATE_COMMAND_ID,
    'rotate',
    before,
    after,
    replaced,
    {
      removeIds: [before.piece.id, ...replaced.map((row) => row.piece.id)],
      insert: [{ index: forwardIndex, piece: after }],
      append: [],
      selectedPieceId: after.id,
    },
    { removeIds: [after.id], insert: [before, ...replaced], append: [], selectedPieceId: world.selectedPieceId },
  );
}

export function planPieceDelete(world: PieceEditWorld, args: PieceDeleteArgs): PieceEditPlan {
  const before = validateWorld(world, args.documentId, args.pieceId);
  return finish(
    world,
    WORLD_PIECE_DELETE_COMMAND_ID,
    'delete',
    before,
    null,
    [],
    { removeIds: [before.piece.id], insert: [], append: [], selectedPieceId: null },
    { removeIds: [], insert: [before], append: [], selectedPieceId: world.selectedPieceId },
  );
}
