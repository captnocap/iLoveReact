// The editor-side half of the single deep character-rig session door.
//
// This coordinator deliberately retains only the opaque native session id,
// revision, and the last compact snapshot. Mesh topology, f32 weights, inverse
// binds, heatmaps, and posed geometry never cross into React state.

import type {
  CharacterRigApi,
  CharacterRigAttachPreflight,
  CharacterRigCommand,
  CharacterRigOpenPayload,
  CharacterRigInspection,
  CharacterRigInspectionQuery,
  CharacterRigSessionReply,
  CharacterRigSessionRequest,
  CharacterRigSnapshot,
  CharacterSaveSnapshot,
  SkinBindingRef,
} from '../../../runtime/skeleton';

export type CharacterRigSessionDoor = (requestJson: string) => unknown;

export class CharacterRigSessionFault extends Error {
  readonly currentRevision?: number;

  constructor(message: string, currentRevision?: number) {
    super(message);
    this.name = 'CharacterRigSessionFault';
    this.currentRevision = currentRevision;
  }
}

function parseReply<T>(raw: unknown): CharacterRigSessionReply<T> {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { ok?: unknown }).ok !== 'boolean') {
    throw new CharacterRigSessionFault('character rig host returned a malformed reply');
  }
  return parsed as CharacterRigSessionReply<T>;
}

function validBodyTopology(value: CharacterRigSnapshot['bodyTopology']): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const counts = [
    value.componentCount,
    value.mainLogicalVertexCount,
    value.mainTriangleCount,
    value.detachedLogicalVertexCount,
    value.detachedTriangleCount,
  ];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0) || value.componentCount < 1 ||
      !Array.isArray(value.detachedFaceIndices) || typeof value.detachedSelectionComplete !== 'boolean') return false;
  const ids = value.detachedFaceIndices;
  if (ids.some((index) => !Number.isSafeInteger(index) || index < 0) || new Set(ids).size !== ids.length ||
      ids.length > value.detachedTriangleCount) return false;
  if (value.detachedSelectionComplete && ids.length !== value.detachedTriangleCount) return false;
  if (value.componentCount === 1 &&
      (value.detachedLogicalVertexCount !== 0 || value.detachedTriangleCount !== 0 || ids.length !== 0)) return false;
  return true;
}

function validSemanticCoverage(value: CharacterRigSnapshot['semanticCoverage']): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const counts = [value.bodyFaceCount, value.coveredBodyFaceCount, value.uncoveredBodyFaceCount];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
      value.coveredBodyFaceCount + value.uncoveredBodyFaceCount !== value.bodyFaceCount ||
      !Array.isArray(value.missingRequiredRoles) ||
      value.missingRequiredRoles.some((key) => typeof key !== 'string' || key.length === 0) ||
      !Array.isArray(value.roleFaceCounts) || value.roleFaceCounts.some((row) =>
        !row || typeof row.key !== 'string' || row.key.length === 0 ||
        !Number.isSafeInteger(row.faceCount) || row.faceCount < 0) ||
      !Array.isArray(value.uncoveredFaceIndices) ||
      value.uncoveredFaceIndices.some((index) => !Number.isSafeInteger(index) || index < 0) ||
      new Set(value.uncoveredFaceIndices).size !== value.uncoveredFaceIndices.length ||
      typeof value.uncoveredSelectionComplete !== 'boolean' ||
      value.uncoveredFaceIndices.length > value.uncoveredBodyFaceCount) return false;
  if (value.uncoveredSelectionComplete &&
      value.uncoveredFaceIndices.length !== value.uncoveredBodyFaceCount) return false;
  return true;
}

function validSemanticBindings(value: CharacterRigSnapshot['semanticBindings']): boolean {
  if (!Array.isArray(value)) return false;
  const roles = new Set([
    'pelvis', 'abdomen', 'chest', 'head', 'upper_arm', 'lower_arm', 'hand',
    'upper_leg', 'lower_leg', 'foot', 'neck', 'clavicle', 'fingers', 'toes',
  ]);
  const paired = new Set([
    'upper_arm', 'lower_arm', 'hand', 'upper_leg', 'lower_leg', 'foot',
    'clavicle', 'fingers', 'toes',
  ]);
  const keys = new Set<string>();
  const bones = new Set<string>();
  for (const binding of value) {
    if (!binding || !roles.has(binding.role) || typeof binding.boneId !== 'string' || binding.boneId.length === 0) return false;
    if (paired.has(binding.role) ? binding.side !== 'left' && binding.side !== 'right' : binding.side !== undefined) return false;
    const key = `${binding.role}${binding.side ? `:${binding.side}` : ''}`;
    if (keys.has(key) || bones.has(binding.boneId)) return false;
    keys.add(key);
    bones.add(binding.boneId);
  }
  return true;
}

function validExercise(value: CharacterRigSnapshot['exercise']): boolean {
  if (value === null) return true;
  return !!value && typeof value === 'object' &&
    typeof value.source === 'string' && value.source.length > 0 &&
    typeof value.name === 'string' &&
    Number.isFinite(value.durationSeconds) && value.durationSeconds > 0 &&
    typeof value.looping === 'boolean' && typeof value.playing === 'boolean' &&
    Number.isFinite(value.playheadSeconds) && value.playheadSeconds >= 0 &&
    Number.isInteger(value.channelCount) && value.channelCount > 0 &&
    Number.isInteger(value.matchedChannelCount) &&
    value.matchedChannelCount >= 0 && value.matchedChannelCount <= value.channelCount;
}

function requireSnapshot(value: CharacterRigSnapshot): CharacterRigSnapshot {
  if (!value || typeof value.sessionId !== 'string' || !Number.isInteger(value.revision)) {
    throw new CharacterRigSessionFault('character rig host returned a malformed snapshot');
  }
  // During an approved core update the cart can hot-reload one revision before
  // the cold host. The old host had no semanticBindings projection; normalize
  // only that absent field to the descriptor's prior empty default.
  if ((value as CharacterRigSnapshot & { semanticBindings?: unknown }).semanticBindings === undefined) {
    value.semanticBindings = [];
  }
  // Same hot-reload skew for the exercise block (req_4323): an older cold host
  // simply has nothing mounted.
  if ((value as CharacterRigSnapshot & { exercise?: unknown }).exercise === undefined) {
    value.exercise = null;
  }
  if (!validExercise(value.exercise)) {
    throw new CharacterRigSessionFault('character rig host returned a malformed exercise block');
  }
  const history = value.history;
  if (!history || typeof history.canUndo !== 'boolean' || typeof history.canRedo !== 'boolean' ||
      !Number.isInteger(history.undoDepth) || history.undoDepth < 0 ||
      !Number.isInteger(history.redoDepth) || history.redoDepth < 0 ||
      history.canUndo !== (history.undoDepth > 0) || history.canRedo !== (history.redoDepth > 0)) {
    throw new CharacterRigSessionFault('character rig host returned malformed history availability');
  }
  if (!validBodyTopology(value.bodyTopology)) {
    throw new CharacterRigSessionFault('character rig host returned malformed body topology diagnostics');
  }
  if (!validSemanticCoverage(value.semanticCoverage)) {
    throw new CharacterRigSessionFault('character rig host returned malformed semantic coverage diagnostics');
  }
  if (!validSemanticBindings(value.semanticBindings)) {
    throw new CharacterRigSessionFault('character rig host returned malformed semantic bone bindings');
  }
  if (typeof value.weightsStale !== 'boolean' || value.bones.some((bone) =>
    !Number.isFinite(bone.segmentLength) || bone.segmentLength < 0)) {
    throw new CharacterRigSessionFault('character rig host returned malformed rig debt or segment lengths');
  }
  return value;
}

function copyOpenPayload(payload: CharacterRigOpenPayload): CharacterRigOpenPayload {
  // The host door is JSON-only. Retaining the payload in its wire-safe form
  // prevents a caller mutation from silently changing what Retry Open means.
  return JSON.parse(JSON.stringify(payload)) as CharacterRigOpenPayload;
}

function faultMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Revision-pinned implementation of CharacterRigApi. A stale command is never
 * retried: the caller must first read the current native snapshot and decide
 * whether its intent still applies. */
export class NativeCharacterRigApi implements CharacterRigApi {
  private sessionId: string | null = null;
  private revision: number | null = null;
  private lastSnapshot: CharacterRigSnapshot | null = null;
  private lastOpenPayload: CharacterRigOpenPayload | null = null;
  private activeOpenPayload: CharacterRigOpenPayload | null = null;
  private lastOpenFault: string | null = null;

  constructor(private readonly resolveDoor: () => CharacterRigSessionDoor | undefined = () =>
    (globalThis as { __character_rig_session?: CharacterRigSessionDoor }).__character_rig_session) {}

  available(): boolean {
    return typeof this.resolveDoor() === 'function';
  }

  preflightAttach(rangeObjectIds: string[]): CharacterRigAttachPreflight {
    return this.call<CharacterRigAttachPreflight>({
      op: 'preflightAttach',
      payload: { rangeObjectIds: [...rangeObjectIds] },
    });
  }

  open(payload: CharacterRigOpenPayload): CharacterRigSnapshot {
    const retainedPayload = copyOpenPayload(payload);
    this.lastOpenPayload = retainedPayload;
    try {
      if (this.sessionId !== null) this.close();
      const opened = this.acceptSnapshot(this.call<CharacterRigSnapshot>({
        op: 'open',
        payload: retainedPayload,
      }));
      this.activeOpenPayload = retainedPayload;
      this.lastOpenFault = null;
      return opened;
    } catch (error) {
      this.lastOpenFault = faultMessage(error);
      throw error;
    }
  }

  currentOpenFault(): string | null {
    return this.lastOpenFault;
  }

  retryOpen(): CharacterRigSnapshot {
    if (this.lastOpenPayload === null) {
      throw new CharacterRigSessionFault('character rig session has no open request to retry');
    }
    return this.open(this.lastOpenPayload);
  }

  command(command: CharacterRigCommand): CharacterRigSnapshot {
    const { sessionId, revision } = this.requireOpen();
    return this.acceptSnapshot(this.call<CharacterRigSnapshot>({
      op: 'command',
      sessionId,
      expectedRevision: revision,
      payload: command,
    }));
  }

  undo(): CharacterRigSnapshot {
    return this.command({ kind: 'undo' });
  }

  redo(): CharacterRigSnapshot {
    return this.command({ kind: 'redo' });
  }

  snapshot(): CharacterRigSnapshot {
    const { sessionId, revision } = this.requireOpen();
    return this.acceptSnapshot(this.call<CharacterRigSnapshot>({
      op: 'snapshot',
      sessionId,
      expectedRevision: revision,
    }));
  }

  inspect<T extends CharacterRigInspection = CharacterRigInspection>(
    query: CharacterRigInspectionQuery,
  ): T {
    const { sessionId, revision } = this.requireOpen();
    return this.call<T>({
      op: 'inspect',
      sessionId,
      expectedRevision: revision,
      payload: query,
    });
  }

  prepareSave(): CharacterSaveSnapshot {
    const { sessionId, revision } = this.requireOpen();
    const prepared = this.call<CharacterSaveSnapshot>({
      op: 'prepareSave',
      sessionId,
      expectedRevision: revision,
    });
    if (!prepared || prepared.sessionId !== sessionId || prepared.revision !== revision) {
      throw new CharacterRigSessionFault('character rig save snapshot does not match the open revision');
    }
    return prepared;
  }

  commitSave(binding: SkinBindingRef | null): CharacterRigSnapshot {
    const { sessionId, revision } = this.requireOpen();
    return this.acceptSnapshot(this.call<CharacterRigSnapshot>({
      op: 'commitSave',
      sessionId,
      expectedRevision: revision,
      payload: { binding },
    }));
  }

  close(): void {
    if (this.sessionId === null) return;
    const sessionId = this.sessionId;
    const expectedRevision = this.revision ?? undefined;
    try {
      this.call<unknown>({ op: 'close', sessionId, expectedRevision });
    } finally {
      // A rejected or malformed close reply must not wedge every later open on
      // a locally retained session id. The original fault still propagates.
      this.clearLocal();
    }
  }

  /** Compact current value for render coordinators. This never polls native. */
  currentSnapshot(): CharacterRigSnapshot | null {
    return this.lastSnapshot;
  }

  currentOpenTarget(): Pick<CharacterRigOpenPayload, 'documentId' | 'modelId' | 'modelSourceKey'> | null {
    const payload = this.activeOpenPayload;
    return payload ? {
      documentId: payload.documentId,
      modelId: payload.modelId,
      modelSourceKey: payload.modelSourceKey,
    } : null;
  }

  private call<T>(request: CharacterRigSessionRequest): T {
    const door = this.resolveDoor();
    if (typeof door !== 'function') throw new CharacterRigSessionFault('character rig host is unavailable');
    let reply: CharacterRigSessionReply<T>;
    try {
      reply = parseReply<T>(door(JSON.stringify(request)));
    } catch (error) {
      if (error instanceof CharacterRigSessionFault) throw error;
      throw new CharacterRigSessionFault(`character rig host reply could not be decoded: ${String(error)}`);
    }
    if (!reply.ok) {
      throw new CharacterRigSessionFault(reply.error, reply.currentRevision);
    }
    return reply.value;
  }

  private acceptSnapshot(snapshot: CharacterRigSnapshot): CharacterRigSnapshot {
    const checked = requireSnapshot(snapshot);
    if (this.sessionId !== null && checked.sessionId !== this.sessionId) {
      throw new CharacterRigSessionFault('character rig host changed session identity');
    }
    if (this.revision !== null && checked.revision < this.revision) {
      throw new CharacterRigSessionFault('character rig host revision moved backwards');
    }
    this.sessionId = checked.sessionId;
    this.revision = checked.revision;
    this.lastSnapshot = checked;
    return checked;
  }

  private requireOpen(): { sessionId: string; revision: number } {
    if (this.sessionId === null || this.revision === null) {
      throw new CharacterRigSessionFault('character rig session is not open');
    }
    return { sessionId: this.sessionId, revision: this.revision };
  }

  private clearLocal(): void {
    this.sessionId = null;
    this.revision = null;
    this.lastSnapshot = null;
    this.activeOpenPayload = null;
  }
}

export function createCharacterRigApi(
  resolveDoor?: () => CharacterRigSessionDoor | undefined,
): NativeCharacterRigApi {
  return new NativeCharacterRigApi(resolveDoor);
}
