// Pure transaction boundary for the authored world-piece placement command.
//
// The viewport resolves pointer/camera geometry into semantic candidates. This
// module starts after that projection work: it validates the submitted world
// mutation, assigns authoritative instance ids, computes footprint replacement,
// and returns exact forward/inverse patches. It has no React, eventbus, host, or
// filesystem dependency. A command authority can therefore run it against the
// editor adapter or a headless/in-memory adapter through the same entrance.
import {
  placementSlotKey,
  WORLD_PIECE_AUTHORING_TUNING,
  type MaterialRef,
  type PlacedPiece,
  type PlacementGesture,
} from './pieces';
import { SURFACE_FLORA_TUNING } from './surfaceFlora';

/** Stable identity of the authored action. `place-piece` elsewhere is the
 * report-only tool choice; this is the mutation that commits resolved pieces. */
export const WORLD_PIECES_PLACE_COMMAND_ID = 'world.pieces.place';

/** The current UI supports storeys Ground..128. The command repeats the bound
 * at its trust boundary so a remote/headless caller cannot bypass the UI clamp. */
export const WORLD_PIECE_PLACEMENT_LIMITS = Object.freeze({
  maxBatchSize: WORLD_PIECE_AUTHORING_TUNING.maxCompositionPieces,
  maxFloor: 128,
});

/** Candidates never choose their durable identity. The empty id is accepted as
 * migration glue for WorldViewport's current PlacedPiece-shaped callback. */
export type PiecePlacementCandidate = Omit<PlacedPiece, 'id'> & { id?: '' };

export type PiecePlacementArgs = {
  /** Named-map identity. Applying candidates to whichever map happens to be
   * open would make delayed/remote invocation corrupt the wrong document. */
  documentId: string;
  candidates: readonly PiecePlacementCandidate[];
  /** Input provenance only; it does not change placement semantics. */
  gestureMode: PlacementGesture['mode'];
};

/** The minimal world projection a privileged adapter supplies. `nextPieceId`
 * is monotonic and deliberately separate from undoable authored content. */
export type PiecePlacementWorld = {
  documentId: string;
  pieces: readonly PlacedPiece[];
  selectedPieceId: string | null;
  nextPieceId: number;
};

export type IndexedPiece = { index: number; piece: PlacedPiece };

/** An exact deterministic list patch. Insertions carry their original index so
 * undo restores ordering, not merely membership. */
export type PieceListPatch = {
  removeIds: readonly string[];
  insert: readonly IndexedPiece[];
  append: readonly PlacedPiece[];
  selectedPieceId: string | null;
};

export type PiecePlacementTransaction = {
  commandId: typeof WORLD_PIECES_PLACE_COMMAND_ID;
  documentId: string;
  action: 'place' | 'replace';
  gestureMode: PlacementGesture['mode'];
  placed: readonly PlacedPiece[];
  removed: readonly IndexedPiece[];
  forward: PieceListPatch;
  inverse: PieceListPatch;
  nextPieceIdBefore: number;
  nextPieceIdAfter: number;
};

export type PiecePlacementPlan = {
  transaction: PiecePlacementTransaction;
  next: PiecePlacementWorld;
};

export type PiecePlacementPolicy = {
  maxBatchSize?: number;
  maxFloor?: number;
  /** The authority owns identity allocation. The editor adapter currently uses
   * `bp_<monotonic number>`; a session/server can substitute its own stable form. */
  makePieceId: (sequence: number) => string;
  /** Semantic/native validation injected by the privileged adapter. It should
   * reject unknown piece ids and any host rule the structural checks cannot see. */
  validateCandidate: (candidate: Readonly<PiecePlacementCandidate>, index: number) => void;
};

export type PiecePlacementRejectCode =
  | 'wrong-document'
  | 'empty-batch'
  | 'batch-too-large'
  | 'invalid-world'
  | 'invalid-candidate'
  | 'duplicate-footprint'
  | 'id-collision'
  | 'stale-patch';

export class PiecePlacementRejected extends Error {
  readonly code: PiecePlacementRejectCode;
  readonly candidateIndex?: number;

  constructor(code: PiecePlacementRejectCode, message: string, candidateIndex?: number) {
    super(message);
    this.name = 'PiecePlacementRejected';
    this.code = code;
    this.candidateIndex = candidateIndex;
  }
}

function reject(code: PiecePlacementRejectCode, message: string, candidateIndex?: number): never {
  throw new PiecePlacementRejected(code, message, candidateIndex);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cloneMaterialRef(ref: MaterialRef): MaterialRef {
  return 'assetId' in ref ? { assetId: ref.assetId } : { fn: ref.fn, variant: ref.variant };
}

function clonePiece<T extends PiecePlacementCandidate | PlacedPiece>(piece: T): T {
  const slots = piece.slots
    ? Object.fromEntries(Object.entries(piece.slots).map(([role, ref]) => [role, cloneMaterialRef(ref)]))
    : undefined;
  return {
    ...piece,
    ...(slots ? { slots } : {}),
    ...(piece.overrides ? { overrides: { ...piece.overrides } } : {}),
    ...(piece.stickers ? { stickers: piece.stickers.map((sticker) => ({ ...sticker })) } : {}),
    ...(piece.surfaceFlora ? { surfaceFlora: piece.surfaceFlora.map((patch) => ({ ...patch })) } : {}),
  };
}

function validateMaterialRef(ref: unknown, index: number, role: string): void {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    reject('invalid-candidate', `candidate ${index} slot '${role}' has no material reference`, index);
  }
  const value = ref as Partial<MaterialRef> & { assetId?: unknown; fn?: unknown; variant?: unknown };
  const byAsset = typeof value.assetId === 'string' && value.assetId.length > 0;
  const byRecipe = typeof value.fn === 'string' && value.fn.length > 0 && finite(value.variant);
  if (!byAsset && !byRecipe) {
    reject('invalid-candidate', `candidate ${index} slot '${role}' has a malformed material reference`, index);
  }
}

function validateCandidateStructure(candidate: PiecePlacementCandidate, index: number, maxFloor: number): void {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    reject('invalid-candidate', `candidate ${index} is not an object`, index);
  }
  if (candidate.id !== undefined && candidate.id !== '') {
    reject('invalid-candidate', `candidate ${index} tried to choose durable id '${candidate.id}'`, index);
  }
  if (typeof candidate.pieceId !== 'string' || candidate.pieceId.length === 0) {
    reject('invalid-candidate', `candidate ${index} has no semantic piece id`, index);
  }
  if (![candidate.x, candidate.y, candidate.z, candidate.yawDegrees].every(finite)) {
    reject('invalid-candidate', `candidate ${index} has a non-finite transform`, index);
  }
  if (!Number.isInteger(candidate.floor) || candidate.floor! < 0 || candidate.floor! > maxFloor) {
    reject('invalid-candidate', `candidate ${index} floor must be an integer from 0 to ${maxFloor}`, index);
  }
  if (candidate.slots !== undefined) {
    if (!candidate.slots || typeof candidate.slots !== 'object' || Array.isArray(candidate.slots)) {
      reject('invalid-candidate', `candidate ${index} slots must be a record`, index);
    }
    for (const [role, ref] of Object.entries(candidate.slots)) {
      if (!role) reject('invalid-candidate', `candidate ${index} has an empty slot role`, index);
      validateMaterialRef(ref, index, role);
    }
  }
  if (candidate.overrides !== undefined) {
    if (!candidate.overrides || typeof candidate.overrides !== 'object' || Array.isArray(candidate.overrides)) {
      reject('invalid-candidate', `candidate ${index} overrides must be a record`, index);
    }
    for (const [path, value] of Object.entries(candidate.overrides)) {
      if (!path || (typeof value !== 'boolean' && !finite(value))) {
        reject('invalid-candidate', `candidate ${index} override '${path}' is malformed`, index);
      }
    }
  }
  if (candidate.spinDegPerSec !== undefined && !finite(candidate.spinDegPerSec)) {
    reject('invalid-candidate', `candidate ${index} spin rate must be finite`, index);
  }
  if (candidate.stickers !== undefined) {
    if (!Array.isArray(candidate.stickers)) reject('invalid-candidate', `candidate ${index} stickers must be an array`, index);
    for (const sticker of candidate.stickers) {
      if (!sticker || typeof sticker !== 'object'
        || typeof sticker.id !== 'string' || typeof sticker.stickerId !== 'string' || typeof sticker.role !== 'string'
        || ![sticker.lx, sticker.ly, sticker.lz, sticker.nx, sticker.ny, sticker.nz, sticker.scale, sticker.rot].every(finite)
        || sticker.scale <= 0 || !Number.isInteger(sticker.rot)) {
        reject('invalid-candidate', `candidate ${index} carries a malformed sticker`, index);
      }
    }
  }
  if (candidate.surfaceFlora !== undefined) {
    if (!Array.isArray(candidate.surfaceFlora) || candidate.surfaceFlora.length > SURFACE_FLORA_TUNING.maxPatchesPerPiece) {
      reject('invalid-candidate', `candidate ${index} surface flora exceeds its bounded recipe budget`, index);
    }
    for (const patch of candidate.surfaceFlora) {
      if (!patch || typeof patch !== 'object'
        || typeof patch.id !== 'string' || typeof patch.speciesId !== 'string' || typeof patch.role !== 'string'
        || !Number.isInteger(patch.triangle) || patch.triangle < 0
        || ![patch.lx, patch.ly, patch.lz, patch.density, patch.radiusM, patch.seed].every(finite)
        || patch.density < 0 || patch.density > 1 || patch.radiusM <= 0 || !Number.isInteger(patch.seed) || patch.seed < 0) {
        reject('invalid-candidate', `candidate ${index} carries a malformed surface flora recipe`, index);
      }
    }
  }
}

function validateWorld(world: PiecePlacementWorld): void {
  if (!world.documentId || !Number.isInteger(world.nextPieceId) || world.nextPieceId < 1) {
    reject('invalid-world', 'world placement adapter supplied an invalid document or id allocator');
  }
  const ids = new Set<string>();
  for (const piece of world.pieces) {
    if (!piece.id || ids.has(piece.id)) reject('invalid-world', `world contains duplicate/empty piece id '${piece.id}'`);
    ids.add(piece.id);
  }
}

/** Apply one exact patch. It rejects stale/missing targets rather than silently
 * producing a plausible but different world after concurrent/intervening edits. */
export function applyPieceListPatch(pieces: readonly PlacedPiece[], patch: PieceListPatch): PlacedPiece[] {
  const existing = new Map(pieces.map((piece) => [piece.id, piece]));
  const remove = new Set<string>();
  for (const id of patch.removeIds) {
    if (!id || remove.has(id) || !existing.has(id)) reject('stale-patch', `patch cannot remove missing/duplicate piece '${id}'`);
    remove.add(id);
  }

  const out = pieces.filter((piece) => !remove.has(piece.id)).map((piece) => clonePiece(piece));
  const liveIds = new Set(out.map((piece) => piece.id));
  const inserts = [...patch.insert].sort((a, b) => a.index - b.index);
  for (const row of inserts) {
    if (!Number.isInteger(row.index) || row.index < 0 || row.index > out.length) {
      reject('stale-patch', `patch insertion index ${row.index} is no longer valid`);
    }
    if (!row.piece.id || liveIds.has(row.piece.id)) reject('stale-patch', `patch insertion collides on '${row.piece.id}'`);
    const piece = clonePiece(row.piece);
    out.splice(row.index, 0, piece);
    liveIds.add(piece.id);
  }
  for (const raw of patch.append) {
    if (!raw.id || liveIds.has(raw.id)) reject('stale-patch', `patch append collides on '${raw.id}'`);
    const piece = clonePiece(raw);
    out.push(piece);
    liveIds.add(piece.id);
  }
  return out;
}

function applyTransactionPatch(
  world: PiecePlacementWorld,
  transaction: PiecePlacementTransaction,
  patch: PieceListPatch,
  advanceAllocator: boolean,
): PiecePlacementWorld {
  if (world.documentId !== transaction.documentId) {
    reject('wrong-document', `placement belongs to '${transaction.documentId}', not '${world.documentId}'`);
  }
  return {
    ...world,
    pieces: applyPieceListPatch(world.pieces, patch),
    selectedPieceId: patch.selectedPieceId,
    // Undo never rewinds identity allocation. Redo may be applied after newer
    // actions and therefore also takes the monotonic maximum.
    nextPieceId: advanceAllocator
      ? Math.max(world.nextPieceId, transaction.nextPieceIdAfter)
      : world.nextPieceId,
  };
}

export function applyPiecePlacementForward(
  world: PiecePlacementWorld,
  transaction: PiecePlacementTransaction,
): PiecePlacementWorld {
  return applyTransactionPatch(world, transaction, transaction.forward, true);
}

export function applyPiecePlacementInverse(
  world: PiecePlacementWorld,
  transaction: PiecePlacementTransaction,
): PiecePlacementWorld {
  return applyTransactionPatch(world, transaction, transaction.inverse, false);
}

/** Plan and apply one semantic placement transaction without side effects. */
export function planPiecePlacement(
  world: PiecePlacementWorld,
  args: PiecePlacementArgs,
  policy: PiecePlacementPolicy,
): PiecePlacementPlan {
  validateWorld(world);
  if (args.documentId !== world.documentId) {
    reject('wrong-document', `placement targets '${args.documentId}', but '${world.documentId}' is active`);
  }
  if (!args.candidates.length) reject('empty-batch', 'placement requires at least one candidate');
  const maxBatchSize = policy.maxBatchSize ?? WORLD_PIECE_PLACEMENT_LIMITS.maxBatchSize;
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || args.candidates.length > maxBatchSize) {
    reject('batch-too-large', `placement batch ${args.candidates.length} exceeds cap ${maxBatchSize}`);
  }
  const maxFloor = policy.maxFloor ?? WORLD_PIECE_PLACEMENT_LIMITS.maxFloor;
  if (!Number.isInteger(maxFloor) || maxFloor < 0) reject('invalid-world', 'placement policy supplied an invalid floor limit');

  const existingIds = new Set(world.pieces.map((piece) => piece.id));
  const footprints = new Set<string>();
  const placed: PlacedPiece[] = [];
  let nextPieceId = world.nextPieceId;
  for (let index = 0; index < args.candidates.length; index += 1) {
    const candidate = args.candidates[index]!;
    validateCandidateStructure(candidate, index, maxFloor);
    policy.validateCandidate(candidate, index);
    const candidateCopy = clonePiece(candidate);
    const footprint = placementSlotKey({ ...candidateCopy, id: '' });
    if (footprints.has(footprint)) {
      reject('duplicate-footprint', `placement batch contains footprint '${footprint}' more than once`, index);
    }
    footprints.add(footprint);
    const id = policy.makePieceId(nextPieceId);
    if (!id || existingIds.has(id) || placed.some((piece) => piece.id === id)) {
      reject('id-collision', `piece id allocator produced unavailable id '${id}'`, index);
    }
    placed.push({ ...candidateCopy, id });
    nextPieceId += 1;
  }

  const removed: IndexedPiece[] = [];
  for (let index = 0; index < world.pieces.length; index += 1) {
    const piece = world.pieces[index]!;
    if (footprints.has(placementSlotKey(piece))) removed.push({ index, piece: clonePiece(piece) });
  }
  const forward: PieceListPatch = {
    removeIds: removed.map((row) => row.piece.id),
    insert: [],
    append: placed,
    selectedPieceId: placed[placed.length - 1]!.id,
  };
  const inverse: PieceListPatch = {
    removeIds: placed.map((piece) => piece.id),
    insert: removed,
    append: [],
    selectedPieceId: world.selectedPieceId,
  };
  const transaction: PiecePlacementTransaction = {
    commandId: WORLD_PIECES_PLACE_COMMAND_ID,
    documentId: world.documentId,
    action: removed.length > 0 ? 'replace' : 'place',
    gestureMode: args.gestureMode,
    placed,
    removed,
    forward,
    inverse,
    nextPieceIdBefore: world.nextPieceId,
    nextPieceIdAfter: nextPieceId,
  };
  return { transaction, next: applyPiecePlacementForward(world, transaction) };
}
