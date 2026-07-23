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
  WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
  WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
  WORLD_PIECE_MATERIAL_COMMAND_IDS,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PIECE_SPIN_COMMAND_ID,
  type WorldPieceEditCommandId,
  type WorldPieceMaterialCommandId,
} from './pieceCommandIds';
export {
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_EDIT_COMMAND_IDS,
  WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
  WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
  WORLD_PIECE_MATERIAL_COMMAND_IDS,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PIECE_SPIN_COMMAND_ID,
} from './pieceCommandIds';
export type { WorldPieceEditCommandId } from './pieceCommandIds';
export type { WorldPieceMaterialCommandId } from './pieceCommandIds';
export type WorldPieceEditAction = 'move' | 'rotate' | 'spin' | 'delete';

export const WORLD_PIECE_EDIT_LIMITS = Object.freeze({ maxFloor: 128 });

/** scale (req_3367 world gizmo): optional uniform instance scale. Absent keeps
 *  the piece's current scale; present it must be finite and > 0. */
export type PieceTransform = Pick<PlacedPiece, 'x' | 'y' | 'z' | 'yawDegrees'> & { floor: number; scale?: number };
export type PieceMoveArgs = { documentId: string; pieceId: string; transform: PieceTransform };
export type PieceRotateArgs = { documentId: string; pieceId: string; quarterTurns: -1 | 1 };
/** spinDegPerSec 0 stops the spin (the field clears); any other finite rate spins.
 *  Negative = counter-clockwise. */
export type PieceSpinArgs = { documentId: string; pieceId: string; spinDegPerSec: number };
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

export type PieceMaterialTarget = {
  pieceId: string;
  /** `all` expands through the semantic piece-role policy at the authority boundary. */
  roles: readonly string[] | 'all';
};
export type PieceMaterialAssignArgs = {
  documentId: string;
  targets: readonly PieceMaterialTarget[];
  materialAssetId: string;
};
export type PieceMaterialClearArgs = {
  documentId: string;
  targets: readonly PieceMaterialTarget[];
};
export type PieceMaterialPolicy = {
  materialAssetExists(assetId: string): boolean;
  rolesForPiece(pieceId: string): readonly string[];
};
export type PieceMaterialAssignment = { pieceId: string; roles: readonly string[] };
export type PieceMaterialTransaction = {
  commandId: WorldPieceMaterialCommandId;
  documentId: string;
  action: 'material.assign' | 'material.clear';
  materialAssetId?: string;
  assignments: readonly PieceMaterialAssignment[];
  before: readonly IndexedPiece[];
  after: readonly IndexedPiece[];
  forward: PieceListPatch;
  inverse: PieceListPatch;
};
export type PieceMaterialPlan = {
  transaction: PieceMaterialTransaction;
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

function applyPatch(world: PieceEditWorld, transaction: { documentId: string }, patch: PieceListPatch): PieceEditWorld {
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
  if (transform.scale !== undefined && (!finite(transform.scale) || transform.scale <= 0)) {
    reject('invalid-args', 'move transform scale must be a finite value above 0');
  }
  // An absent scale keeps the piece's current one — spreading an undefined key
  // would silently reset a scaled prop to authored size on every plain move.
  const { scale: nextScale, ...coreTransform } = transform;
  const after = clonePiece({ ...before.piece, ...coreTransform, ...(nextScale !== undefined ? { scale: nextScale } : {}) });
  if (before.piece.x === after.x && before.piece.y === after.y && before.piece.z === after.z &&
      before.piece.yawDegrees === after.yawDegrees && before.piece.floor === after.floor &&
      (before.piece.scale ?? 1) === (after.scale ?? 1)) {
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

/** SPINPROP req_3128: set (or clear, rate 0) a piece's continuous visual spin.
 *  The footprint never changes — no destination victims; the row keeps its list
 *  position so toggling spin causes zero ordering churn. */
export function planPieceSpin(world: PieceEditWorld, args: PieceSpinArgs): PieceEditPlan {
  const before = validateWorld(world, args.documentId, args.pieceId);
  if (!finite(args.spinDegPerSec)) {
    reject('invalid-args', 'spinDegPerSec must be a finite number (0 stops the spin)');
  }
  const current = before.piece.spinDegPerSec ?? 0;
  if (current === args.spinDegPerSec) {
    reject('no-change', `piece '${args.pieceId}' already spins at ${args.spinDegPerSec}°/s`);
  }
  const after = clonePiece(before.piece);
  if (args.spinDegPerSec === 0) delete after.spinDegPerSec;
  else after.spinDegPerSec = args.spinDegPerSec;
  return finish(
    world,
    WORLD_PIECE_SPIN_COMMAND_ID,
    'spin',
    before,
    after,
    [],
    {
      removeIds: [before.piece.id],
      insert: [{ index: before.index, piece: after }],
      append: [],
      selectedPieceId: after.id,
    },
    { removeIds: [after.id], insert: [before], append: [], selectedPieceId: world.selectedPieceId },
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

type NormalizedMaterialTarget = { before: IndexedPiece; roles: string[] };

function normalizeMaterialTargets(
  world: PieceEditWorld,
  documentId: string,
  targets: readonly PieceMaterialTarget[],
  policy: PieceMaterialPolicy,
): NormalizedMaterialTarget[] {
  if (!Array.isArray(targets) || targets.length === 0) reject('invalid-args', 'material edit requires at least one target');
  const requested = new Map<string, Set<string> | 'all'>();
  for (const target of targets) {
    if (!target || typeof target.pieceId !== 'string' || !target.pieceId) {
      reject('invalid-args', 'material target requires a pieceId');
    }
    if (target.roles === 'all') {
      requested.set(target.pieceId, 'all');
      continue;
    }
    if (!Array.isArray(target.roles) || target.roles.length === 0 || target.roles.some((role) => typeof role !== 'string' || !role)) {
      reject('invalid-args', `material target '${target.pieceId}' requires one or more roles`);
    }
    if (requested.get(target.pieceId) === 'all') continue;
    const current = requested.get(target.pieceId);
    const roles = current instanceof Set ? current : new Set<string>();
    for (const role of target.roles) roles.add(role);
    requested.set(target.pieceId, roles);
  }

  const normalized: NormalizedMaterialTarget[] = [];
  for (const [instanceId, rolesRequested] of requested) {
    const before = validateWorld(world, documentId, instanceId);
    const supported = [...policy.rolesForPiece(before.piece.pieceId)];
    if (supported.length === 0) reject('invalid-args', `piece '${instanceId}' exposes no material roles`);
    const roles = rolesRequested === 'all' ? supported : [...rolesRequested];
    for (const role of roles) {
      if (!supported.includes(role)) {
        reject('invalid-args', `piece '${instanceId}' does not expose material role '${role}'`);
      }
    }
    normalized.push({ before, roles });
  }
  return normalized.sort((a, b) => a.before.index - b.before.index);
}

function finishMaterial(
  world: PieceEditWorld,
  commandId: WorldPieceMaterialCommandId,
  action: PieceMaterialTransaction['action'],
  materialAssetId: string | undefined,
  changed: readonly { before: IndexedPiece; after: IndexedPiece; roles: readonly string[] }[],
): PieceMaterialPlan {
  if (changed.length === 0) reject('no-change', 'material edit would not change any piece role');
  const transaction: PieceMaterialTransaction = {
    commandId,
    documentId: world.documentId,
    action,
    ...(materialAssetId ? { materialAssetId } : {}),
    assignments: changed.map((row) => ({ pieceId: row.before.piece.id, roles: row.roles })),
    before: changed.map((row) => row.before),
    after: changed.map((row) => row.after),
    forward: {
      removeIds: changed.map((row) => row.before.piece.id),
      insert: changed.map((row) => row.after),
      append: [],
      selectedPieceId: world.selectedPieceId,
    },
    inverse: {
      removeIds: changed.map((row) => row.after.piece.id),
      insert: changed.map((row) => row.before),
      append: [],
      selectedPieceId: world.selectedPieceId,
    },
  };
  return { transaction, next: applyPieceMaterialForward(world, transaction) };
}

export function applyPieceMaterialForward(
  world: PieceEditWorld,
  transaction: PieceMaterialTransaction,
): PieceEditWorld {
  return applyPatch(world, transaction, transaction.forward);
}

export function applyPieceMaterialInverse(
  world: PieceEditWorld,
  transaction: PieceMaterialTransaction,
): PieceEditWorld {
  return applyPatch(world, transaction, transaction.inverse);
}

export function planPieceMaterialAssign(
  world: PieceEditWorld,
  args: PieceMaterialAssignArgs,
  policy: PieceMaterialPolicy,
): PieceMaterialPlan {
  if (typeof args.materialAssetId !== 'string' || !args.materialAssetId || !policy.materialAssetExists(args.materialAssetId)) {
    reject('invalid-args', `unknown material asset '${args.materialAssetId}'`);
  }
  const targets = normalizeMaterialTargets(world, args.documentId, args.targets, policy);
  const changed: Array<{ before: IndexedPiece; after: IndexedPiece; roles: string[] }> = [];
  for (const target of targets) {
    const slots = { ...(target.before.piece.slots ?? {}) };
    const roles = target.roles.filter((role) => {
      const current = slots[role];
      return !current || !('assetId' in current) || current.assetId !== args.materialAssetId;
    });
    if (roles.length === 0) continue;
    for (const role of roles) slots[role] = { assetId: args.materialAssetId };
    changed.push({
      before: target.before,
      after: { index: target.before.index, piece: clonePiece({ ...target.before.piece, slots }) },
      roles,
    });
  }
  return finishMaterial(world, WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID, 'material.assign', args.materialAssetId, changed);
}

export function planPieceMaterialClear(
  world: PieceEditWorld,
  args: PieceMaterialClearArgs,
  policy: PieceMaterialPolicy,
): PieceMaterialPlan {
  const targets = normalizeMaterialTargets(world, args.documentId, args.targets, policy);
  const changed: Array<{ before: IndexedPiece; after: IndexedPiece; roles: string[] }> = [];
  for (const target of targets) {
    const slots = { ...(target.before.piece.slots ?? {}) };
    const roles = target.roles.filter((role) => Object.prototype.hasOwnProperty.call(slots, role));
    if (roles.length === 0) continue;
    for (const role of roles) delete slots[role];
    const piece = clonePiece(target.before.piece);
    if (Object.keys(slots).length > 0) piece.slots = slots;
    else delete piece.slots;
    changed.push({ before: target.before, after: { index: target.before.index, piece }, roles });
  }
  return finishMaterial(world, WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID, 'material.clear', undefined, changed);
}
