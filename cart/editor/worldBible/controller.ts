// Long-lived World Bible controller.  It intentionally lives outside the
// general EditorState blob: canonical source, divergent drafts, and frozen
// write proposals have a stricter lifecycle than ordinary view persistence.
import { finalizePendingRecovery, listDir, mkdir, readFile, removeFileDurable, restoreFileBytesAtomicIfUnchanged, writeFileBytesAtomic, writeFileBytesAtomicIfUnchanged } from '../../../runtime/hooks/fs';
import { EDITOR_DATA_ROOT } from '../data/editorDataRoot';
import { textBytes } from '../../../runtime/workspace/lumps';
import {
  KNOWLEDGE_KINDS,
  draftFromPage,
  kindIs,
  parseKnowledgePage,
  type KnowledgeDiagnostic,
  type KnowledgeDraft,
  type KnowledgeFact,
  type KnowledgeKind,
  type KnowledgePage,
} from './blockFormat';
import { buildKnowledgeCatalog } from './model';
import {
  confirmKnowledgeWrite,
  isKnowledgeSourcePath,
  knowledgeDraftChanged,
  knowledgeSourceState,
  newKnowledgeSession,
  openKnowledgeSession,
  prepareKnowledgeWrite,
  refreshKnowledgeDisk,
  reloadKnowledgeFromDisk,
  revertKnowledgeDraft,
  setKnowledgeDraft,
  type KnowledgeFilePort,
  type KnowledgeSession,
  type KnowledgeSourceState,
  type KnowledgeWriteProposal,
} from './session';

export const WORLD_KNOWLEDGE_ROOT = 'world/knowledge';
export const WORLD_BIBLE_RECOVERY_ROOT = `${EDITOR_DATA_ROOT}/world-bible-drafts`;
export const WORLD_BIBLE_RECOVERY_FILE = `${WORLD_BIBLE_RECOVERY_ROOT}/session.json`;

export type WorldBibleMode = 'read' | 'edit' | 'review';
export type WorldBibleKindFilter = KnowledgeKind | 'all';
export type WorldBibleDiscardAction = 'revert' | 'reload';

export type WorldBibleSnapshot = {
  loaded: boolean;
  sessions: readonly KnowledgeSession[];
  selectedRef: string | null;
  selectedPath: string | null;
  query: string;
  kindFilter: WorldBibleKindFilter;
  mode: WorldBibleMode;
  proposal: KnowledgeWriteProposal | null;
  pendingDiscard: WorldBibleDiscardAction | null;
  notice: string;
  diagnostics: readonly KnowledgeDiagnostic[];
  revision: number;
};

const hostPort: KnowledgeFilePort = {
  read: (path) => readFile(path),
  list: (path) => listDir(path),
  writeAtomic: (path, source) => writeFileBytesAtomic(path, textBytes(source)),
  writeAtomicIfUnchanged: (path, expectedSource, source) => writeFileBytesAtomicIfUnchanged(
    path,
    expectedSource === null ? null : textBytes(expectedSource),
    textBytes(source),
  ),
  writeAtomicIfUnchangedTransient: (path, expectedSource, source) => writeFileBytesAtomicIfUnchanged(
    path,
    expectedSource === null ? null : textBytes(expectedSource),
    textBytes(source),
    false,
  ),
  restoreAtomicIfUnchanged: (path, expectedSource, source, retainPrevious, pendingOwnerPath) => restoreFileBytesAtomicIfUnchanged(
    path,
    expectedSource === null ? null : textBytes(expectedSource),
    textBytes(source),
    pendingOwnerPath,
    retainPrevious,
  ),
  finalizePendingRecovery: (path, expectedSource, preparedPath, retirePrevious) => finalizePendingRecovery(
    path,
    textBytes(expectedSource),
    preparedPath,
    retirePrevious,
  ),
  removeDurable: (path) => removeFileDurable(path),
};

function pathForRef(ref: string): string {
  const trimmed = ref.trim();
  const stem = /^[a-z0-9][a-z0-9._:-]*$/.test(trimmed)
    ? trimmed.replace(/:/g, '~c')
    : [...trimmed].map((character) => /[a-z0-9-]/.test(character)
      ? character
      : `~${character.codePointAt(0)!.toString(16)}~`).join('') || 'untitled';
  return `${WORLD_KNOWLEDGE_ROOT}/${stem}.md`;
}

function directoryEntries(port: KnowledgeFilePort, path = WORLD_KNOWLEDGE_ROOT): string[] {
  let entries: string[] = [];
  try { entries = port.list ? port.list(path) : listDir(path); } catch { entries = []; }
  return entries;
}

function pageFiles(port: KnowledgeFilePort): string[] {
  const entries = directoryEntries(port);
  return entries
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('.') && !entry.startsWith('_'))
    .sort()
    .map((entry) => `${WORLD_KNOWLEDGE_ROOT}/${entry}`);
}

function emptyDraft(kind: KnowledgeKind, sequence: number): KnowledgeDraft {
  const prefix = kind === 'business' ? 'biz' : kind === 'person' ? 'npc' : kind;
  const ref = `${prefix}.untitled_${sequence}`;
  return {
    kind,
    ref,
    name: `Untitled ${kind[0]!.toUpperCase()}${kind.slice(1)}`,
    logo: '',
    authorText: '',
    publicText: '',
    notesText: '',
    facts: [],
  };
}

function sortSessions(sessions: readonly KnowledgeSession[]): KnowledgeSession[] {
  return [...sessions].sort((a, b) => a.draft.name.localeCompare(b.draft.name) || a.draft.ref.localeCompare(b.draft.ref));
}

type RecoveryEntry = {
  path: string;
  baseSource: string | null;
  draft: KnowledgeDraft;
};

function recoveryDraft(value: unknown): KnowledgeDraft | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== 'string' || !kindIs(raw.kind) || typeof raw.ref !== 'string' || typeof raw.name !== 'string') return null;
  if (typeof raw.logo !== 'string' || typeof raw.publicText !== 'string' || typeof raw.notesText !== 'string' || !Array.isArray(raw.facts)) return null;
  // v1 recovery envelopes predate the literal Markdown author-text field.
  // Missing is a safe migration to empty; any other non-string value is not.
  const authorText = raw.authorText === undefined ? '' : raw.authorText;
  if (typeof authorText !== 'string') return null;
  const facts: KnowledgeFact[] = [];
  for (const valueFact of raw.facts) {
    if (!valueFact || typeof valueFact !== 'object') return null;
    const fact = valueFact as Record<string, unknown>;
    if (typeof fact.key !== 'string' || typeof fact.label !== 'string' || typeof fact.value !== 'string') return null;
    if (fact.visibility !== 'public' && fact.visibility !== 'secret' && fact.visibility !== 'author') return null;
    facts.push({ key: fact.key, label: fact.label, value: fact.value, visibility: fact.visibility });
  }
  return { kind: raw.kind, ref: raw.ref, name: raw.name, logo: raw.logo, authorText, publicText: raw.publicText, notesText: raw.notesText, facts };
}

function recoveryEnvelopeIsValid(source: string | null): source is string {
  if (source === null) return false;
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { return false; }
  if (!raw || typeof raw !== 'object' || (raw as any).version !== 1 || !Array.isArray((raw as any).entries)) return false;
  const paths = new Set<string>();
  for (const value of (raw as any).entries as unknown[]) {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.path !== 'string'
      || !isKnowledgeSourcePath(entry.path)
      || !entry.path.startsWith(`${WORLD_KNOWLEDGE_ROOT}/`)
      || paths.has(entry.path)
      || (entry.baseSource !== null && typeof entry.baseSource !== 'string')
      || !recoveryDraft(entry.draft)
    ) return false;
    paths.add(entry.path);
    if (typeof entry.baseSource === 'string') {
      try { openKnowledgeSession(entry.path, entry.baseSource); } catch { return false; }
    }
  }
  return true;
}

function compareWrite(
  port: KnowledgeFilePort,
  path: string,
  expected: string | null,
  source: string,
  transient: boolean,
  recoveryOwnerPath: string | null = null,
): 'written' | 'changed' | 'failed' {
  if (recoveryOwnerPath !== null) {
    return port.restoreAtomicIfUnchanged
      ? port.restoreAtomicIfUnchanged(path, expected, source, !transient, recoveryOwnerPath)
      : 'failed';
  }
  const conditional = transient
    ? port.writeAtomicIfUnchangedTransient ?? port.writeAtomicIfUnchanged
    : port.writeAtomicIfUnchanged;
  if (conditional) return conditional.call(port, path, expected, source);
  return port.read(path) !== expected
    ? 'changed'
    : port.writeAtomic(path, source) ? 'written' : 'failed';
}

export const WORLD_BIBLE_CONTROLLER_TUNING = {
  recoveryDebounceMs: 240,
  diagnosticsDebounceMs: 180,
  diskRefreshCoalesceMs: 90,
} as const;

function scheduleTask(callback: () => void, delayMs: number): number | null {
  const schedule = (globalThis as any).setTimeout;
  return typeof schedule === 'function' ? schedule(callback, delayMs) as number : null;
}

function cancelTask(id: number): void {
  const cancel = (globalThis as any).clearTimeout;
  if (typeof cancel === 'function') cancel(id);
}

function catalogPageForSession(session: KnowledgeSession): KnowledgePage {
  // buildKnowledgeCatalog deliberately consumes only the semantic page fields
  // plus diagnostics. Supplying the draft here makes cross-page validation see
  // recovered and not-yet-confirmed edits without treating them as canonical.
  return {
    ...(session.basePage ?? {}),
    ...session.draft,
    path: session.path,
    source: session.diskSource ?? session.baseSource ?? '',
    diagnostics: session.basePage?.diagnostics ?? [],
  } as KnowledgePage;
}

function dedupeDiagnostics(diagnostics: readonly KnowledgeDiagnostic[]): KnowledgeDiagnostic[] {
  const seen = new Set<string>();
  const result: KnowledgeDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}\0${diagnostic.code}\0${diagnostic.path ?? ''}\0${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}

export class WorldBibleController {
  private sessions: KnowledgeSession[] = [];
  private selectedRef: string | null = null;
  private selectedPath: string | null = null;
  private query = '';
  private kindFilter: WorldBibleKindFilter = 'all';
  private mode: WorldBibleMode = 'read';
  private proposal: KnowledgeWriteProposal | null = null;
  private pendingDiscard: WorldBibleDiscardAction | null = null;
  private pendingDiscardPath: string | null = null;
  private notice = '';
  private diagnostics: KnowledgeDiagnostic[] = [];
  private transientDiagnostics: KnowledgeDiagnostic[] = [];
  private controllerDiagnostics = new Map<string, KnowledgeDiagnostic>();
  private recoveryTimer: number | null = null;
  private diagnosticsTimer: number | null = null;
  private diskRefreshTimer: number | null = null;
  private recoveryRewriteBlockReason: string | null = null;
  private recoverySource: string | null = null;
  private recoveryNeedsWrite = false;
  private loaded = false;
  private revision = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly port: KnowledgeFilePort = hostPort) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): WorldBibleSnapshot {
    return {
      loaded: this.loaded,
      sessions: this.sessions,
      selectedRef: this.selectedRef,
      selectedPath: this.selectedPath,
      query: this.query,
      kindFilter: this.kindFilter,
      mode: this.mode,
      proposal: this.proposal,
      pendingDiscard: this.pendingDiscard,
      notice: this.notice,
      diagnostics: this.diagnostics,
      revision: this.revision,
    };
  }

  private publish(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  private replaceSession(previous: KnowledgeSession, next: KnowledgeSession): void {
    const replaced = this.sessions.map((session) => session === previous ? next : session);
    this.sessions = previous.draft.name !== next.draft.name || previous.draft.ref !== next.draft.ref
      ? sortSessions(replaced)
      : replaced;
    if (this.selectedPath === previous.path) this.selectedPath = next.path;
    if (this.selectedPath === next.path) this.selectedRef = next.draft.ref;
  }

  private recomputeDiagnostics(): void {
    if (this.diagnosticsTimer !== null) {
      cancelTask(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
    }
    const catalog = buildKnowledgeCatalog(this.sessions.map(catalogPageForSession));
    const pathOwners = new Map<string, KnowledgeSession[]>();
    for (const session of this.sessions) {
      const owners = pathOwners.get(session.path) ?? [];
      owners.push(session);
      pathOwners.set(session.path, owners);
    }
    const pathDiagnostics: KnowledgeDiagnostic[] = [];
    for (const [path, owners] of pathOwners) {
      if (owners.length < 2) continue;
      pathDiagnostics.push({
        severity: 'error',
        code: 'path-duplicate',
        message: `File "${path}" is targeted by ${owners.map((owner) => owner.draft.ref).join(', ')}.`,
        path,
      });
    }
    this.diagnostics = dedupeDiagnostics([
      ...this.controllerDiagnostics.values(),
      ...catalog.diagnostics,
      ...pathDiagnostics,
      ...this.transientDiagnostics,
    ]);
  }

  private scheduleDiagnostics(): void {
    if (this.diagnosticsTimer !== null) cancelTask(this.diagnosticsTimer);
    const timer = scheduleTask(() => {
      this.diagnosticsTimer = null;
      this.recomputeDiagnostics();
      this.publish();
    }, WORLD_BIBLE_CONTROLLER_TUNING.diagnosticsDebounceMs);
    if (timer === null) this.recomputeDiagnostics();
    else this.diagnosticsTimer = timer;
  }

  private clearTransientDiagnostics(): void {
    this.transientDiagnostics = [];
  }

  private clearPendingDiscard(): void {
    this.pendingDiscard = null;
    this.pendingDiscardPath = null;
  }

  private recoveryEntries(): RecoveryEntry[] {
    return this.sessions
      .filter(knowledgeDraftChanged)
      .map((session) => ({ path: session.path, baseSource: session.baseSource, draft: session.draft }));
  }

  private writeRecoveryNow(): boolean {
    if (this.recoveryTimer !== null) {
      cancelTask(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (this.recoveryRewriteBlockReason) {
      const hadDiagnostic = this.controllerDiagnostics.has('recovery-rewrite-blocked');
      this.controllerDiagnostics.set('recovery-rewrite-blocked', {
        severity: 'error',
        code: 'draft-recovery-rewrite-blocked',
        message: `${this.recoveryRewriteBlockReason} The existing recovery file was preserved byte-for-byte. Resolve ${WORLD_BIBLE_RECOVERY_FILE} manually before relying on new draft recovery.`,
        path: WORLD_BIBLE_RECOVERY_FILE,
      });
      if (!hadDiagnostic) this.recomputeDiagnostics();
      return false;
    }
    const hadFailure = this.controllerDiagnostics.has('recovery-write') || this.controllerDiagnostics.has('recovery-concurrent-change');
    const nextSource = JSON.stringify({ version: 1, entries: this.recoveryEntries() });
    let result: 'written' | 'changed' | 'failed' = 'failed';
    try {
      mkdir(WORLD_BIBLE_RECOVERY_ROOT);
      // Draft recovery is app-owned and high-frequency. It uses the same
      // expected-content claim as canonical writes, but retires the displaced
      // envelope after a successful install instead of accumulating one full
      // predecessor for every 240 ms edit burst.
      result = compareWrite(this.port, WORLD_BIBLE_RECOVERY_FILE, this.recoverySource, nextSource, true);
    } catch {
      result = 'failed';
    }
    const ok = result === 'written';
    if (ok) {
      this.recoverySource = nextSource;
      this.recoveryNeedsWrite = false;
      this.controllerDiagnostics.delete('recovery-write');
      this.controllerDiagnostics.delete('recovery-concurrent-change');
    } else if (result === 'changed') {
      this.recoveryRewriteBlockReason = 'Another editor process changed the recovery envelope after this process loaded it.';
      this.controllerDiagnostics.set('recovery-concurrent-change', {
        severity: 'error',
        code: 'draft-recovery-concurrent-change',
        message: `Another editor process changed ${WORLD_BIBLE_RECOVERY_FILE}; its drafts were preserved and this process will not overwrite them.`,
        path: WORLD_BIBLE_RECOVERY_FILE,
      });
    } else {
      if (this.port.read(WORLD_BIBLE_RECOVERY_FILE) === nextSource) {
        this.recoverySource = nextSource;
        this.recoveryNeedsWrite = true;
      }
      this.controllerDiagnostics.set('recovery-write', {
        severity: 'error',
        code: 'draft-recovery-write-failed',
        message: this.recoverySource === nextSource
          ? `Draft recovery bytes reached ${WORLD_BIBLE_RECOVERY_FILE}, but the durability check failed. The draft remains in memory and will be retried.`
          : `Draft recovery could not be written to ${WORLD_BIBLE_RECOVERY_FILE}. The in-memory draft is still present, but it will not survive a restart.`,
        path: WORLD_BIBLE_RECOVERY_FILE,
      });
    }
    const hasFailure = this.controllerDiagnostics.has('recovery-write') || this.controllerDiagnostics.has('recovery-concurrent-change');
    if (hadFailure !== hasFailure) this.recomputeDiagnostics();
    return ok;
  }

  private scheduleRecovery(): void {
    if (this.recoveryTimer !== null) cancelTask(this.recoveryTimer);
    this.recoveryTimer = scheduleTask(() => {
      this.recoveryTimer = null;
      const hadFailure = this.controllerDiagnostics.has('recovery-write');
      const ok = this.writeRecoveryNow();
      if (!ok || hadFailure) this.publish();
    }, WORLD_BIBLE_CONTROLLER_TUNING.recoveryDebounceMs);
  }

  /** Force the coalesced noncanonical recovery envelope to durable storage. */
  flushRecovery(): boolean {
    const ok = this.writeRecoveryNow();
    this.publish();
    return ok;
  }

  private persistRecovery(): void {
    this.recoveryNeedsWrite = true;
    this.scheduleRecovery();
  }

  private recoverDrafts(sessions: KnowledgeSession[], diagnostics: KnowledgeDiagnostic[]): { sessions: KnowledgeSession[]; count: number } {
    const source = this.port.read(WORLD_BIBLE_RECOVERY_FILE);
    this.recoverySource = source;
    if (source === null) return { sessions, count: 0 };
    const rejectRecovery = (code: string, message: string, path = WORLD_BIBLE_RECOVERY_FILE) => {
      this.recoveryRewriteBlockReason = message;
      diagnostics.push({
        severity: 'error',
        code,
        message: `${message} The original recovery file was preserved and automatic rewrites are blocked.`,
        path,
      });
    };
    let raw: unknown;
    try { raw = JSON.parse(source); }
    catch {
      rejectRecovery('draft-recovery-invalid', `Could not parse ${WORLD_BIBLE_RECOVERY_FILE}.`);
      return { sessions, count: 0 };
    }
    if (!raw || typeof raw !== 'object' || (raw as any).version !== 1 || !Array.isArray((raw as any).entries)) {
      rejectRecovery('draft-recovery-version-unsupported', `Unsupported recovery envelope in ${WORLD_BIBLE_RECOVERY_FILE}.`);
      return { sessions, count: 0 };
    }
    let next = [...sessions];
    let count = 0;
    const recoveredPaths = new Set<string>();
    for (const value of (raw as any).entries as unknown[]) {
      if (!value || typeof value !== 'object') {
        rejectRecovery('draft-recovery-entry-invalid', 'A recovery entry is not an object.');
        continue;
      }
      const entry = value as Record<string, unknown>;
      if (
        typeof entry.path !== 'string'
        || !isKnowledgeSourcePath(entry.path)
        || !entry.path.startsWith(`${WORLD_KNOWLEDGE_ROOT}/`)
      ) {
        rejectRecovery('draft-recovery-path-invalid', 'A recovered draft targets a path outside the canonical World Bible directory.');
        continue;
      }
      if (recoveredPaths.has(entry.path)) {
        rejectRecovery('draft-recovery-path-duplicate', `A second recovered draft targets ${entry.path}.`, entry.path);
        continue;
      }
      recoveredPaths.add(entry.path);
      const draft = recoveryDraft(entry.draft);
      const baseSource = typeof entry.baseSource === 'string' ? entry.baseSource : entry.baseSource === null ? null : undefined;
      if (!draft || baseSource === undefined) {
        rejectRecovery('draft-recovery-entry-invalid', `The recovered draft for ${entry.path} has an unsupported shape.`, entry.path);
        continue;
      }
      try {
        let recovered = baseSource === null
          ? newKnowledgeSession(entry.path, draft)
          : setKnowledgeDraft(openKnowledgeSession(entry.path, baseSource), draft);
        recovered = refreshKnowledgeDisk(recovered, this.port.read(entry.path));
        const existing = next.findIndex((session) => session.path === entry.path);
        if (existing >= 0) next[existing] = recovered;
        else next.push(recovered);
        count += 1;
      } catch {
        rejectRecovery('draft-recovery-entry-invalid', `The recovered draft for ${entry.path} is invalid.`, entry.path);
      }
    }
    return { sessions: sortSessions(next), count };
  }

  private retireClaimFile(path: string, diagnostics: KnowledgeDiagnostic[], scope: 'canonical' | 'draft'): boolean {
    if (this.port.read(path) === null) return true;
    if (this.port.removeDurable?.(path)) return true;
    // Another recovering editor may have retired the same globally named
    // marker after our existence read. Treat the now-absent end state as the
    // same idempotent success, not as a false durability failure.
    if (this.port.read(path) === null) return true;
    diagnostics.push({
      severity: 'error',
      code: `${scope}-claim-marker-retire-failed`,
      message: `Could not durably retire interrupted-write marker ${path}. It was preserved; do not delete the restored source until this is resolved.`,
      path,
    });
    if (scope === 'draft') {
      this.recoveryRewriteBlockReason = `Interrupted draft marker ${path} could not be durably retired.`;
    }
    return false;
  }

  private finalizePendingOwnership(
    targetPath: string,
    expectedSource: string,
    preparedPath: string,
    retirePrevious: boolean,
    diagnostics: KnowledgeDiagnostic[],
    scope: 'canonical' | 'draft',
  ): boolean {
    const finalize = this.port.finalizePendingRecovery;
    const result = finalize
      ? finalize.call(this.port, targetPath, expectedSource, preparedPath, retirePrevious)
      : 'failed';
    if (result === 'finalized') return true;
    const markerPath = `${targetPath}.write-pending`;
    diagnostics.push({
      severity: 'error',
      code: `${scope}-pending-finalize-${result}`,
      message: result === 'changed'
        ? `Recovery artifacts and pending ownership at ${markerPath} were preserved because the target bytes or prepared-path owner changed while finalizing.`
        : `Recovery artifacts and pending ownership at ${markerPath} could not be finalized through the lock-scoped owner/content check and were preserved.`,
      path: targetPath,
    });
    if (scope === 'draft') {
      this.recoveryRewriteBlockReason = `Pending draft ownership for ${targetPath} could not be retired safely.`;
    }
    return false;
  }

  /**
   * Draft recovery is itself crash recoverable. The prepared temp is the newest
   * fsynced envelope, while `.previous` is the older claimed one. Prefer the
   * valid temp, fall back to the valid predecessor, then durably disarm the
   * marker pair. Successful transient writes normally leave no predecessor;
   * lone predecessors from a crash after install are safe to prune only when a
   * valid current envelope proves that install completed. The fixed-name
   * pending marker carries the exact versioned prepared path, so a missing-temp
   * predecessor is recoverable only when that owner payload matches exactly.
   */
  private recoverInterruptedDraftClaims(diagnostics: KnowledgeDiagnostic[]): number {
    const pendingPath = `${WORLD_BIBLE_RECOVERY_FILE}.write-pending`;
    const recoveryEntries = directoryEntries(this.port, WORLD_BIBLE_RECOVERY_ROOT);
    const preparedTemps = recoveryEntries
      .filter((entry) => /^session\.json\.tmp\.[0-9]+$/.test(entry));
    const claims = recoveryEntries
      .map((entry) => {
        const match = /^session\.json\.tmp\.([0-9]+)\.previous$/.exec(entry);
        return match ? { stamp: match[1]!, backup: entry, temp: entry.slice(0, -'.previous'.length) } : null;
      })
      .filter((claim): claim is NonNullable<typeof claim> => claim !== null)
      .sort((left, right) => right.stamp.length - left.stamp.length || right.stamp.localeCompare(left.stamp));
    let recovered = 0;
    for (const claim of claims) {
      const tempPath = `${WORLD_BIBLE_RECOVERY_ROOT}/${claim.temp}`;
      const backupPath = `${WORLD_BIBLE_RECOVERY_ROOT}/${claim.backup}`;
      const tempSource = this.port.read(tempPath);
      const backupSource = this.port.read(backupPath);
      let current = this.port.read(WORLD_BIBLE_RECOVERY_FILE);

      if (tempSource === null) {
        const pendingOwner = this.port.read(pendingPath);
        // The install completed and only its displaced app-owned envelope
        // survived cleanup. The current session is authoritative and durable.
        if (recoveryEnvelopeIsValid(current) && pendingOwner === tempPath) {
          this.finalizePendingOwnership(WORLD_BIBLE_RECOVERY_FILE, current, tempPath, true, diagnostics, 'draft');
        } else if (current === null && pendingOwner === tempPath && recoveryEnvelopeIsValid(backupSource)) {
          const result = compareWrite(this.port, WORLD_BIBLE_RECOVERY_FILE, null, backupSource, true, tempPath);
          current = this.port.read(WORLD_BIBLE_RECOVERY_FILE);
          if ((result === 'written' || current === backupSource)
            && this.finalizePendingOwnership(WORLD_BIBLE_RECOVERY_FILE, backupSource, tempPath, true, diagnostics, 'draft')) {
            recovered += 1;
          } else {
            this.recoveryRewriteBlockReason = `Bound draft predecessor ${backupPath} could not be restored and finalized.`;
            diagnostics.push({
              severity: 'error',
              code: 'draft-claim-restore-failed',
              message: `Could not restore and finalize bound draft predecessor ${backupPath}; all remaining ownership artifacts were preserved.`,
              path: WORLD_BIBLE_RECOVERY_FILE,
            });
          }
        } else if (current === null && pendingOwner !== null && recoveryEnvelopeIsValid(backupSource)) {
          // A differently-owned fixed marker may belong to a newer transaction.
          // Preserve both rather than resurrecting stale history.
          this.recoveryRewriteBlockReason = `Pending draft ownership does not match predecessor ${backupPath}.`;
          diagnostics.push({
            severity: 'error',
            code: 'draft-claim-predecessor-ambiguous',
            message: `Valid predecessor ${backupPath} has no matching temp and the pending marker names a different transaction, so nothing was restored and automatic rewrites were blocked.`,
            path: WORLD_BIBLE_RECOVERY_FILE,
          });
        } else if (recoveryEnvelopeIsValid(current) && backupSource !== null) {
          this.retireClaimFile(backupPath, diagnostics, 'draft');
        } else if (current !== null && recoveryEnvelopeIsValid(backupSource)) {
          this.recoveryRewriteBlockReason = `Malformed current recovery envelope has a valid preserved predecessor at ${backupPath}.`;
          diagnostics.push({
            severity: 'error',
            code: 'draft-claim-predecessor-preserved',
            message: `Current ${WORLD_BIBLE_RECOVERY_FILE} is invalid, so its valid predecessor ${backupPath} was preserved for manual recovery and automatic rewrites were blocked.`,
            path: WORLD_BIBLE_RECOVERY_FILE,
          });
        }
        continue;
      }

      const tempValid = recoveryEnvelopeIsValid(tempSource);
      const backupValid = recoveryEnvelopeIsValid(backupSource);
      if (!tempValid && !backupValid) {
        this.recoveryRewriteBlockReason = `Interrupted draft claim ${tempPath} contains no valid recovery envelope.`;
        diagnostics.push({
          severity: 'error',
          code: 'draft-claim-invalid',
          message: `Neither side of interrupted draft claim ${tempPath} is a valid recovery envelope. Both artifacts were preserved.`,
          path: WORLD_BIBLE_RECOVERY_FILE,
        });
        continue;
      }

      let chosen = tempValid ? tempSource : backupSource!;
      if (current !== null && current !== chosen) {
        // A restore may have installed the predecessor just before crashing.
        // Complete that exact transition to the newer validated temp. Any
        // unrelated current bytes are a real multi-process conflict.
        if (tempValid && backupValid && current === backupSource) {
          const result = compareWrite(this.port, WORLD_BIBLE_RECOVERY_FILE, current, tempSource, true, tempPath);
          current = this.port.read(WORLD_BIBLE_RECOVERY_FILE);
          if (result !== 'written' && current !== tempSource) {
            this.recoveryRewriteBlockReason = `Draft recovery changed while interrupted claim ${tempPath} was being completed.`;
            diagnostics.push({
              severity: 'error',
              code: 'draft-claim-conflict',
              message: `Could not complete interrupted draft claim ${tempPath} because another editor owns the current recovery envelope. Artifacts were preserved.`,
              path: WORLD_BIBLE_RECOVERY_FILE,
            });
            continue;
          }
          chosen = tempSource;
        } else {
          this.recoveryRewriteBlockReason = `Interrupted draft claim ${tempPath} conflicts with the current recovery envelope.`;
          diagnostics.push({
            severity: 'error',
            code: 'draft-claim-conflict',
            message: `Interrupted draft claim ${tempPath} does not match the current recovery envelope. Nothing was overwritten and both artifacts were preserved.`,
            path: WORLD_BIBLE_RECOVERY_FILE,
          });
          continue;
        }
      }

      if (current === null) {
        const result = compareWrite(this.port, WORLD_BIBLE_RECOVERY_FILE, null, chosen, true, tempPath);
        current = this.port.read(WORLD_BIBLE_RECOVERY_FILE);
        if (result !== 'written' && current !== chosen) {
          this.recoveryRewriteBlockReason = `Interrupted draft claim ${tempPath} could not be restored.`;
          diagnostics.push({
            severity: 'error',
            code: 'draft-claim-restore-failed',
            message: `Could not restore interrupted draft claim ${tempPath}; both recovery artifacts were preserved.`,
            path: WORLD_BIBLE_RECOVERY_FILE,
          });
          continue;
        }
        recovered += 1;
      }

      if (current === chosen) {
        // One native boundary rechecks target bytes plus marker ownership and
        // retires temp, predecessor, then pending while holding the same lock.
        this.finalizePendingOwnership(
          WORLD_BIBLE_RECOVERY_FILE,
          chosen,
          tempPath,
          true,
          diagnostics,
          'draft',
        );
      }
    }
    if (this.port.read(pendingPath) !== null) {
      const current = this.port.read(WORLD_BIBLE_RECOVERY_FILE);
      const activePreparedTemp = preparedTemps.some((entry) => this.port.read(`${WORLD_BIBLE_RECOVERY_ROOT}/${entry}`) !== null);
      if (recoveryEnvelopeIsValid(current) && !activePreparedTemp) {
        const ownerPath = this.port.read(pendingPath);
        if (ownerPath && /^zig-out\/game\/editor\/world-bible-drafts\/session\.json\.tmp\.[0-9]+$/.test(ownerPath)) {
          this.finalizePendingOwnership(WORLD_BIBLE_RECOVERY_FILE, current, ownerPath, true, diagnostics, 'draft');
        }
      }
      if (this.port.read(pendingPath) !== null) {
        this.recoveryRewriteBlockReason = `Interrupted draft transaction marker ${pendingPath} still owns an unresolved recovery state.`;
        diagnostics.push({
          severity: 'error',
          code: 'draft-pending-preserved',
          message: `Durable draft transaction marker ${pendingPath} was preserved because no validated, conflict-free recovery envelope occupies its target. Automatic rewrites remain blocked.`,
          path: WORLD_BIBLE_RECOVERY_FILE,
        });
      }
    }
    return recovered;
  }

  /**
   * The native conditional writer leaves a synchronized `<temp, previous>`
   * pair if the process dies after claiming the canonical pathname but before
   * installing the reviewed proposal. Restore only that explicit pair. A lone
   * history backup never resurrects a file intentionally deleted on disk.
   */
  private recoverInterruptedCanonicalClaims(diagnostics: KnowledgeDiagnostic[]): number {
    const knowledgeEntries = directoryEntries(this.port);
    const preparedTemps = knowledgeEntries
      .map((entry) => {
        const match = /^([A-Za-z0-9][A-Za-z0-9._~-]*\.md)\.tmp\.[0-9]+$/.exec(entry);
        return match ? { canonical: match[1]!, temp: entry } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const claims = knowledgeEntries
      .map((entry) => {
        const match = /^([A-Za-z0-9][A-Za-z0-9._~-]*\.md)\.tmp\.([0-9]+)\.previous$/.exec(entry);
        return match ? { canonical: match[1]!, stamp: match[2]!, backup: entry, temp: entry.slice(0, -'.previous'.length) } : null;
      })
      .filter((claim): claim is NonNullable<typeof claim> => claim !== null)
      .sort((left, right) => right.stamp.length - left.stamp.length || right.stamp.localeCompare(left.stamp));
    let restored = 0;
    for (const claim of claims) {
      const canonicalPath = `${WORLD_KNOWLEDGE_ROOT}/${claim.canonical}`;
      const tempPath = `${WORLD_KNOWLEDGE_ROOT}/${claim.temp}`;
      const backupPath = `${WORLD_KNOWLEDGE_ROOT}/${claim.backup}`;
      const source = this.port.read(backupPath);
      if (source === null) continue;
      if (this.port.read(tempPath) === null) {
        const pendingPath = `${canonicalPath}.write-pending`;
        const pendingOwner = this.port.read(pendingPath);
        const current = this.port.read(canonicalPath);
        if (pendingOwner === tempPath && (current === null || current === source)) {
          const result = current === source
            ? 'written'
            : compareWrite(this.port, canonicalPath, null, source, false, tempPath);
          if ((result === 'written' || this.port.read(canonicalPath) === source)
            && this.finalizePendingOwnership(canonicalPath, source, tempPath, false, diagnostics, 'canonical')) {
            if (current === null) restored += 1;
            diagnostics.push({
              severity: 'warning',
              code: 'canonical-claim-restored',
              message: `Recovered ${canonicalPath} from its transaction-bound predecessor and retired pending ownership. Prior-version history remains available for inspection.`,
              path: canonicalPath,
            });
          } else {
            diagnostics.push({
              severity: 'error',
              code: 'canonical-claim-restore-failed',
              message: `Could not restore and finalize transaction-bound predecessor ${backupPath}; remaining artifacts were preserved.`,
              path: canonicalPath,
            });
          }
          continue;
        }
        diagnostics.push({
          severity: 'warning',
          code: 'canonical-prior-version-retained',
          message: `Retained prior-version inode ${backupPath} has no matching prepared temp and is excluded from compile. Inspect it if an external editor kept the old file open during confirmation; a pending marker cannot authorize replay because it may belong to a newer transaction.`,
          path: canonicalPath,
        });
        continue;
      }
      const before = this.port.read(canonicalPath);
      if (before !== null && before !== source) {
        diagnostics.push({
          severity: 'error',
          code: 'canonical-claim-conflict',
          message: `Interrupted canonical claim ${tempPath} conflicts with current bytes. Its artifacts were preserved and nothing was overwritten.`,
          path: canonicalPath,
        });
        continue;
      }
      const result = before === source
        ? 'written'
        : compareWrite(this.port, canonicalPath, null, source, false, tempPath);
      if (result === 'written') {
        if (before === null) restored += 1;
        const ownershipRetired = this.finalizePendingOwnership(
          canonicalPath,
          source,
          tempPath,
          false,
          diagnostics,
          'canonical',
        );
        diagnostics.push({
          severity: ownershipRetired ? 'warning' : 'error',
          code: 'canonical-claim-restored',
          message: ownershipRetired
            ? `Restored ${canonicalPath} from durable prior bytes and retired replay plus pending ownership. The prior-version backup remains available for inspection.`
            : `Restored ${canonicalPath}, but its replay or pending ownership could not be durably retired.`,
          path: canonicalPath,
        });
      } else if (result === 'failed' && this.port.read(canonicalPath) === source) {
        diagnostics.push({
          severity: 'error',
          code: 'canonical-claim-restore-durability',
          message: `Restored bytes reached ${canonicalPath}, but directory durability could not be confirmed. Verify the source before continuing.`,
          path: canonicalPath,
        });
      } else if (this.port.read(canonicalPath) === null) {
        diagnostics.push({
          severity: 'error',
          code: 'canonical-claim-restore-failed',
          message: `Could not restore the interrupted canonical claim at ${backupPath}; both recovery artifacts were preserved.`,
          path: canonicalPath,
        });
      }
    }
    const pendingEntries = directoryEntries(this.port)
      .map((entry) => {
        const match = /^([A-Za-z0-9][A-Za-z0-9._~-]*\.md)\.write-pending$/.exec(entry);
        return match ? { canonical: match[1]!, marker: entry } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    for (const pending of pendingEntries) {
      const canonicalPath = `${WORLD_KNOWLEDGE_ROOT}/${pending.canonical}`;
      const markerPath = `${WORLD_KNOWLEDGE_ROOT}/${pending.marker}`;
      const activePreparedTemp = preparedTemps.some((entry) => entry.canonical === pending.canonical && this.port.read(`${WORLD_KNOWLEDGE_ROOT}/${entry.temp}`) !== null);
      const current = this.port.read(canonicalPath);
      if (current !== null && !activePreparedTemp) {
        const ownerPath = this.port.read(markerPath);
        if (ownerPath && ownerPath.startsWith(`${canonicalPath}.tmp.`) && /^[0-9]+$/.test(ownerPath.slice(`${canonicalPath}.tmp.`.length))) {
          this.finalizePendingOwnership(canonicalPath, current, ownerPath, false, diagnostics, 'canonical');
        }
      }
      if (this.port.read(markerPath) !== null) {
        diagnostics.push({
          severity: 'error',
          code: 'canonical-pending-preserved',
          message: `Durable transaction marker ${markerPath} was preserved because ${canonicalPath} is still absent or has an unresolved prepared temp. Expected-absence writes remain blocked.`,
          path: canonicalPath,
        });
      }
    }
    return restored;
  }

  ensureLoaded(): void {
    if (this.loaded) return;
    mkdir(WORLD_KNOWLEDGE_ROOT);
    mkdir(WORLD_BIBLE_RECOVERY_ROOT);
    const sessions: KnowledgeSession[] = [];
    const diagnostics: KnowledgeDiagnostic[] = [];
    const restoredDraftClaims = this.recoverInterruptedDraftClaims(diagnostics);
    const restoredClaims = this.recoverInterruptedCanonicalClaims(diagnostics);
    for (const path of pageFiles(this.port)) {
      const source = this.port.read(path);
      if (source === null) continue;
      const page = parseKnowledgePage(source, path);
      if (!page) {
        diagnostics.push({ severity: 'error', code: 'entity-missing', message: 'No supported entity block found.', path });
        continue;
      }
      sessions.push(openKnowledgeSession(path, source));
    }
    const recovered = this.recoverDrafts(sortSessions(sessions), diagnostics);
    this.sessions = recovered.sessions;
    if (!this.recoveryRewriteBlockReason && this.recoverySource !== null) {
      this.recoveryNeedsWrite = this.recoverySource !== JSON.stringify({ version: 1, entries: this.recoveryEntries() });
    }
    for (let index = 0; index < diagnostics.length; index += 1) {
      const diagnostic = diagnostics[index]!;
      const key = diagnostic.code === 'entity-missing' && diagnostic.path
        ? `source:${diagnostic.path}`
        : `load:${index}`;
      this.controllerDiagnostics.set(key, diagnostic);
    }
    const priorSelection = this.selectedPath
      ? this.sessions.find((session) => session.path === this.selectedPath)
      : null;
    const selected = priorSelection ?? this.sessions[0] ?? null;
    this.selectedPath = selected?.path ?? null;
    this.selectedRef = selected?.draft.ref ?? null;
    this.loaded = true;
    this.notice = restoredClaims
      ? `Recovered ${restoredClaims} interrupted file write${restoredClaims === 1 ? '' : 's'}`
      : restoredDraftClaims
      ? `Recovered ${restoredDraftClaims} interrupted draft save${restoredDraftClaims === 1 ? '' : 's'}`
      : recovered.count
      ? `Recovered ${recovered.count} draft${recovered.count === 1 ? '' : 's'}`
      : '';
    this.recomputeDiagnostics();
    this.publish();
  }

  selectedSession(): KnowledgeSession | null {
    this.ensureLoaded();
    if (this.selectedPath) {
      const selected = this.sessions.find((session) => session.path === this.selectedPath);
      if (selected) return selected;
    }
    if (this.selectedRef) {
      const matches = this.sessions.filter((session) => session.draft.ref === this.selectedRef);
      if (matches.length === 1) return matches[0]!;
    }
    return this.sessions[0] ?? null;
  }

  select(ref: string): void {
    this.ensureLoaded();
    const matches = this.sessions.filter((session) => session.draft.ref === ref);
    if (matches.length !== 1) {
      if (matches.length > 1) {
        this.notice = `Ref ${ref} is ambiguous; select the page by file path.`;
        this.publish();
      }
      return;
    }
    this.selectedPath = matches[0]!.path;
    this.selectedRef = ref;
    this.mode = 'read';
    this.proposal = null;
    this.clearPendingDiscard();
    this.clearTransientDiagnostics();
    this.notice = '';
    this.recomputeDiagnostics();
    this.publish();
  }

  selectPath(path: string): void {
    this.ensureLoaded();
    const session = this.sessions.find((candidate) => candidate.path === path);
    if (!session) return;
    this.selectedPath = session.path;
    this.selectedRef = session.draft.ref;
    this.mode = 'read';
    this.proposal = null;
    this.clearPendingDiscard();
    this.clearTransientDiagnostics();
    this.notice = '';
    this.recomputeDiagnostics();
    this.publish();
  }

  setQuery(query: string): void {
    this.query = query;
    this.publish();
  }

  setKindFilter(filter: WorldBibleKindFilter): void {
    if (filter !== 'all' && !kindIs(filter)) return;
    this.kindFilter = filter;
    this.publish();
  }

  setMode(mode: Exclude<WorldBibleMode, 'review'>): void {
    this.mode = mode;
    this.proposal = null;
    this.clearPendingDiscard();
    this.publish();
  }

  beginNew(kind: KnowledgeKind = 'business'): void {
    this.ensureLoaded();
    let sequence = 1;
    let draft = emptyDraft(kind, sequence);
    while (this.sessions.some((session) => session.draft.ref === draft.ref || session.path === pathForRef(draft.ref))) {
      sequence += 1;
      draft = emptyDraft(kind, sequence);
    }
    const session = newKnowledgeSession(pathForRef(draft.ref), draft);
    this.sessions = sortSessions([...this.sessions, session]);
    this.selectedPath = session.path;
    this.selectedRef = draft.ref;
    this.mode = 'edit';
    this.proposal = null;
    this.clearPendingDiscard();
    this.clearTransientDiagnostics();
    this.notice = `New ${kind} draft`;
    this.persistRecovery();
    this.recomputeDiagnostics();
    this.publish();
  }

  updateDraft(update: (draft: KnowledgeDraft) => KnowledgeDraft): void {
    const session = this.selectedSession();
    if (!session) return;
    const priorRef = session.draft.ref;
    const nextDraft = update({ ...session.draft, facts: session.draft.facts.map((fact) => ({ ...fact })) });
    if (nextDraft.ref !== priorRef && this.sessions.some((candidate) => candidate !== session && candidate.draft.ref === nextDraft.ref)) {
      this.notice = `Ref ${nextDraft.ref} is already owned by another page`;
      this.publish();
      return;
    }
    let next = setKnowledgeDraft(session, nextDraft);
    if (session.baseSource === null && nextDraft.ref !== priorRef) {
      const nextPath = pathForRef(nextDraft.ref);
      const pathOwner = this.sessions.find((candidate) => candidate !== session && candidate.path === nextPath);
      if (pathOwner) {
        this.notice = `Path ${nextPath} is already targeted by ${pathOwner.draft.ref}`;
        this.publish();
        return;
      }
      next = { ...next, path: nextPath };
    }
    this.replaceSession(session, next);
    this.selectedRef = nextDraft.ref;
    this.mode = 'edit';
    this.proposal = null;
    this.clearPendingDiscard();
    this.clearTransientDiagnostics();
    this.notice = '';
    this.persistRecovery();
    this.scheduleDiagnostics();
    this.publish();
  }

  patchDraft(patch: Partial<Omit<KnowledgeDraft, 'facts'>>): void {
    this.updateDraft((draft) => ({ ...draft, ...patch }));
  }

  updateFact(key: string, patch: Partial<Omit<KnowledgeFact, 'key'>>): void {
    this.updateDraft((draft) => ({
      ...draft,
      facts: draft.facts.map((fact) => fact.key === key ? { ...fact, ...patch } : fact),
    }));
  }

  renameFactKey(key: string, nextKey: string): void {
    const normalized = nextKey.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const session = this.selectedSession();
    if (!session || !normalized || (normalized !== key && session.draft.facts.some((fact) => fact.key === normalized))) {
      this.notice = normalized ? `Fact key ${normalized} already exists` : 'Fact key cannot be empty';
      this.publish();
      return;
    }
    this.updateDraft((draft) => ({
      ...draft,
      facts: draft.facts.map((fact) => fact.key === key ? { ...fact, key: normalized } : fact),
    }));
  }

  addFact(): void {
    const session = this.selectedSession();
    if (!session) return;
    let sequence = 1;
    let key = 'new_fact';
    const keys = new Set(session.draft.facts.map((fact) => fact.key));
    while (keys.has(key)) { sequence += 1; key = `new_fact_${sequence}`; }
    this.updateDraft((draft) => ({ ...draft, facts: [...draft.facts, { key, label: 'New fact', value: '', visibility: 'author' }] }));
  }

  removeFact(key: string): void {
    this.updateDraft((draft) => ({ ...draft, facts: draft.facts.filter((fact) => fact.key !== key) }));
  }

  refreshDisk(): void {
    if (this.diskRefreshTimer !== null) {
      cancelTask(this.diskRefreshTimer);
      this.diskRefreshTimer = null;
    }
    this.ensureLoaded();
    this.clearPendingDiscard();
    this.clearTransientDiagnostics();
    for (const key of [...this.controllerDiagnostics.keys()]) {
      if (key.startsWith('source:') || key.startsWith('external:')) this.controllerDiagnostics.delete(key);
    }
    const diskPaths = pageFiles(this.port);
    const next: KnowledgeSession[] = [];
    for (const session of this.sessions) {
      const source = this.port.read(session.path);
      if (source === null) {
        if (knowledgeDraftChanged(session)) next.push(refreshKnowledgeDisk(session, null));
        continue;
      }
      const page = parseKnowledgePage(source, session.path);
      if (!page || page.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        next.push(refreshKnowledgeDisk(session, source));
        this.controllerDiagnostics.set(`external:${session.path}`, {
          severity: 'error',
          code: 'external-reload-malformed',
          message: `The file changed at ${session.path}, but it does not parse cleanly. The draft was preserved.`,
          path: session.path,
        });
        continue;
      }
      next.push(refreshKnowledgeDisk(session, source));
    }
    const existingPaths = new Set(next.map((session) => session.path));
    for (const path of diskPaths) {
      if (existingPaths.has(path)) continue;
      const source = this.port.read(path);
      const page = source === null ? null : parseKnowledgePage(source, path);
      if (source !== null && page && !page.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        next.push(openKnowledgeSession(path, source));
        existingPaths.add(path);
      } else if (source !== null) {
        this.controllerDiagnostics.set(`source:${path}`, {
          severity: 'error',
          code: 'entity-missing',
          message: 'The file does not contain one valid supported entity block.',
          path,
        });
      }
    }
    this.sessions = sortSessions(next);
    const selected = (this.selectedPath ? this.sessions.find((session) => session.path === this.selectedPath) : null)
      ?? this.sessions[0]
      ?? null;
    this.selectedPath = selected?.path ?? null;
    this.selectedRef = selected?.draft.ref ?? null;
    this.proposal = null;
    if (this.mode === 'review') this.mode = selected && knowledgeDraftChanged(selected) ? 'edit' : 'read';
    this.notice = 'Files rechecked';
    this.recomputeDiagnostics();
    this.publish();
  }

  /** Coalesce one filesystem save's create/rename/modify burst into one pass. */
  requestDiskRefresh(): void {
    if (this.diskRefreshTimer !== null) return;
    const timer = scheduleTask(() => {
      this.diskRefreshTimer = null;
      this.refreshDisk();
    }, WORLD_BIBLE_CONTROLLER_TUNING.diskRefreshCoalesceMs);
    if (timer === null) this.refreshDisk();
    else this.diskRefreshTimer = timer;
  }

  /** Settle authoring-only work before the shell enters live /play. */
  settleBeforePlay(): boolean {
    if (this.diskRefreshTimer !== null) {
      cancelTask(this.diskRefreshTimer);
      this.diskRefreshTimer = null;
    }
    if (this.diagnosticsTimer !== null) {
      cancelTask(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
    }
    if (!this.loaded) return true;
    if (!this.sessions.some(knowledgeDraftChanged)) {
      if (this.recoveryTimer !== null) {
        cancelTask(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      return true;
    }
    const ok = this.writeRecoveryNow();
    this.notice = ok
      ? 'Draft recovery saved'
      : 'Play blocked because the draft recovery file could not be saved.';
    this.publish();
    return ok;
  }

  private collisionDiagnosticsFor(session: KnowledgeSession): KnowledgeDiagnostic[] {
    const diagnostics: KnowledgeDiagnostic[] = [];
    const refOwners = this.sessions.filter((candidate) => candidate.draft.ref === session.draft.ref);
    if (refOwners.length > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'ref-duplicate',
        message: `Ref "${session.draft.ref}" is owned by ${refOwners.map((owner) => owner.path).join(', ')}. Resolve the collision before review.`,
        path: session.path,
      });
    }
    const pathOwners = this.sessions.filter((candidate) => candidate.path === session.path);
    const unbasedDraftTargetsExistingFile = session.baseSource === null && this.port.read(session.path) !== null;
    if (pathOwners.length > 1 || unbasedDraftTargetsExistingFile) {
      diagnostics.push({
        severity: 'error',
        code: 'path-duplicate',
        message: unbasedDraftTargetsExistingFile
          ? `New draft ${session.draft.ref} targets ${session.path}, but that file already exists. Resolve the collision before review.`
          : `File "${session.path}" is targeted by ${pathOwners.map((owner) => owner.draft.ref).join(', ')}. Resolve the collision before review.`,
        path: session.path,
      });
    }
    return diagnostics;
  }

  reviewSelected(): boolean {
    const session = this.selectedSession();
    if (!session) return false;
    this.writeRecoveryNow();
    this.clearPendingDiscard();
    const collisions = this.collisionDiagnosticsFor(session);
    if (collisions.length) {
      this.proposal = null;
      this.mode = 'edit';
      this.transientDiagnostics = collisions;
      this.notice = 'Review blocked: this draft has an ambiguous ref or file path.';
      this.recomputeDiagnostics();
      this.publish();
      return false;
    }
    const prepared = prepareKnowledgeWrite(session, this.port.read(session.path));
    this.replaceSession(session, prepared.session);
    if (!prepared.ok) {
      this.proposal = null;
      this.mode = knowledgeDraftChanged(prepared.session) ? 'edit' : 'read';
      this.transientDiagnostics = prepared.diagnostics;
      this.notice = prepared.error;
      this.recomputeDiagnostics();
      this.publish();
      return false;
    }
    this.proposal = prepared.proposal;
    this.mode = 'review';
    this.transientDiagnostics = prepared.proposal.diagnostics;
    this.notice = `Reviewing ${prepared.proposal.path}`;
    this.recomputeDiagnostics();
    this.publish();
    return true;
  }

  confirmSelected(proposalId: string): boolean {
    const session = this.selectedSession();
    const proposal = this.proposal;
    if (!session || !proposal || proposal.id !== proposalId) {
      this.notice = 'That write proposal is no longer current.';
      this.publish();
      return false;
    }
    const result = confirmKnowledgeWrite(session, proposal, this.port);
    this.replaceSession(session, result.session);
    if (!result.ok) {
      this.proposal = null;
      this.mode = knowledgeDraftChanged(result.session) ? 'edit' : 'read';
      this.notice = result.error;
      this.writeRecoveryNow();
      this.recomputeDiagnostics();
      this.publish();
      return false;
    }
    this.selectedPath = result.session.path;
    this.selectedRef = result.page.ref;
    this.proposal = null;
    this.mode = 'read';
    this.clearPendingDiscard();
    this.clearTransientDiagnostics();
    this.notice = `Wrote ${result.session.path}`;
    this.writeRecoveryNow();
    this.recomputeDiagnostics();
    this.publish();
    return true;
  }

  requestDiscard(action: WorldBibleDiscardAction): boolean {
    const session = this.selectedSession();
    if (!session) return false;
    this.writeRecoveryNow();
    if (action === 'revert' && !knowledgeDraftChanged(session)) {
      this.notice = 'The selected page has no draft changes to discard.';
      this.publish();
      return false;
    }
    if (action === 'reload') {
      const refreshed = refreshKnowledgeDisk(session, this.port.read(session.path));
      this.replaceSession(session, refreshed);
      if (refreshed.diskSource === null) {
        this.notice = `${session.path} no longer exists on disk; the draft was preserved.`;
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      const page = parseKnowledgePage(refreshed.diskSource, refreshed.path);
      if (!page || page.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        this.controllerDiagnostics.set(`external:${session.path}`, {
          severity: 'error',
          code: 'external-reload-malformed',
          message: `Cannot reload ${session.path}: the file is malformed. The draft was preserved.`,
          path: session.path,
        });
        this.notice = `Cannot reload malformed file ${session.path}; the draft was preserved.`;
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
    }
    this.pendingDiscard = action;
    this.pendingDiscardPath = session.path;
    this.proposal = null;
    this.notice = '';
    this.recomputeDiagnostics();
    this.publish();
    return true;
  }

  cancelDiscard(): void {
    if (!this.pendingDiscard) return;
    this.writeRecoveryNow();
    this.clearPendingDiscard();
    this.notice = '';
    this.recomputeDiagnostics();
    this.publish();
  }

  confirmDiscard(): boolean {
    const action = this.pendingDiscard;
    const path = this.pendingDiscardPath;
    const session = path ? this.sessions.find((candidate) => candidate.path === path) ?? null : null;
    if (!action || !session) {
      this.notice = 'There is no current discard request to confirm.';
      this.clearPendingDiscard();
      this.publish();
      return false;
    }
    if (this.recoveryRewriteBlockReason) {
      this.notice = `Discard is blocked because ${WORLD_BIBLE_RECOVERY_FILE} could not be safely interpreted. Its original bytes and the in-app draft were preserved.`;
      this.recomputeDiagnostics();
      this.publish();
      return false;
    }
    if (action === 'reload') {
      const source = this.port.read(session.path);
      const refreshed = refreshKnowledgeDisk(session, source);
      if (source === null) {
        this.replaceSession(session, refreshed);
        this.notice = `${session.path} no longer exists on disk; the draft was preserved.`;
        this.clearPendingDiscard();
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      const page = parseKnowledgePage(source, session.path);
      if (!page || page.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        this.replaceSession(session, refreshed);
        this.controllerDiagnostics.set(`external:${session.path}`, {
          severity: 'error',
          code: 'external-reload-malformed',
          message: `Cannot reload ${session.path}: the file is malformed. The draft was preserved.`,
          path: session.path,
        });
        this.notice = `Cannot reload malformed file ${session.path}; the draft was preserved.`;
        this.clearPendingDiscard();
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      let next: KnowledgeSession;
      try {
        next = reloadKnowledgeFromDisk(refreshed);
      } catch {
        this.notice = `Could not reload ${session.path}; the draft was preserved.`;
        this.clearPendingDiscard();
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      this.replaceSession(session, next);
      this.selectedPath = next.path;
      this.selectedRef = next.draft.ref;
      this.controllerDiagnostics.delete(`external:${session.path}`);
      this.notice = `Reloaded ${next.path}`;
    } else if (session.baseSource === null) {
      this.sessions = this.sessions.filter((candidate) => candidate !== session);
      const selected = this.sessions[0] ?? null;
      this.selectedPath = selected?.path ?? null;
      this.selectedRef = selected?.draft.ref ?? null;
      this.notice = 'Draft discarded';
    } else {
      const next = revertKnowledgeDraft(session);
      this.replaceSession(session, next);
      this.selectedPath = next.path;
      this.selectedRef = next.draft.ref;
      this.notice = `Reverted ${next.path}`;
    }
    this.clearPendingDiscard();
    this.proposal = null;
    this.mode = 'read';
    this.clearTransientDiagnostics();
    this.writeRecoveryNow();
    this.recomputeDiagnostics();
    this.publish();
    return true;
  }

  /** Compatibility shims remain request-only: neither can erase a draft. */
  revertSelected(): void { this.requestDiscard('revert'); }

  reloadSelected(): boolean { return this.requestDiscard('reload'); }

  stateFor(session: KnowledgeSession): KnowledgeSourceState {
    return knowledgeSourceState(session);
  }

  hasDrafts(): boolean {
    if (!this.loaded) return false;
    const dirty = this.sessions.some(knowledgeDraftChanged);
    if (this.recoveryRewriteBlockReason) return dirty;
    if (!dirty && this.recoveryTimer === null && !this.recoveryNeedsWrite && !this.controllerDiagnostics.has('recovery-write')) return false;
    // This is the close/exit guard used by AppFrame. Make the recovery copy
    // durable before reporting that the user has draft work to resolve.
    const recoveryOk = this.writeRecoveryNow();
    // A failed attempt to clear an old envelope is also unsafe to ignore: it
    // could resurrect a discarded draft on restart even when memory is clean.
    return dirty || !recoveryOk;
  }

  requestReviewFirstDraft(): boolean {
    this.ensureLoaded();
    const session = this.sessions.find(knowledgeDraftChanged);
    if (!session) return false;
    this.selectedPath = session.path;
    this.selectedRef = session.draft.ref;
    return this.reviewSelected();
  }

  supportedKinds(): readonly KnowledgeKind[] { return KNOWLEDGE_KINDS; }
}

export const worldBibleController = new WorldBibleController();

export function worldBibleHasDrafts(): boolean {
  return worldBibleController.hasDrafts();
}

export function requestWorldBibleReview(): boolean {
  return worldBibleController.requestReviewFirstDraft();
}

export function stateColor(state: KnowledgeSourceState): string {
  if (state === 'DISK') return 'theme:success';
  if (state === 'DRAFT CHANGED') return 'theme:warning';
  return 'theme:error';
}
