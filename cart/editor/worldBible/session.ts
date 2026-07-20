import { sha256Hex } from '../../../runtime/workspace/sha256';
import { textBytes } from '../../../runtime/workspace/lumps';
import {
  draftFromPage,
  parseKnowledgePage,
  patchKnowledgePage,
  semanticChanges,
  serializeNewKnowledgePage,
  sourcePatchPreview,
  type KnowledgeDiagnostic,
  type KnowledgeDraft,
  type KnowledgePage,
  type SemanticChange,
} from './blockFormat';

export type KnowledgeSourceState = 'DISK' | 'DRAFT CHANGED' | 'DISK CHANGED' | 'CONFLICT';

export type KnowledgeSession = {
  path: string;
  baseSource: string | null;
  baseHash: string | null;
  basePage: KnowledgePage | null;
  diskSource: string | null;
  diskHash: string | null;
  draft: KnowledgeDraft;
};

export type KnowledgeWriteProposal = {
  readonly id: string;
  readonly path: string;
  readonly expectedDiskHash: string | null;
  readonly before: string | null;
  readonly after: string;
  readonly patch: string;
  readonly changes: readonly Readonly<SemanticChange>[];
  readonly diagnostics: readonly Readonly<KnowledgeDiagnostic>[];
};

export type PrepareResult =
  | { ok: true; session: KnowledgeSession; proposal: KnowledgeWriteProposal }
  | { ok: false; session: KnowledgeSession; state: KnowledgeSourceState; error: string; diagnostics: KnowledgeDiagnostic[] };

export type ConfirmResult =
  | { ok: true; session: KnowledgeSession; page: KnowledgePage }
  | { ok: false; session: KnowledgeSession; state: KnowledgeSourceState; error: string };

export type KnowledgeFilePort = {
  read(path: string): string | null;
  list?(path: string): string[];
  writeAtomic(path: string, source: string): boolean;
  writeAtomicIfUnchanged?(
    path: string,
    expectedSource: string | null,
    source: string,
  ): 'written' | 'changed' | 'failed';
  writeAtomicIfUnchangedTransient?(
    path: string,
    expectedSource: string | null,
    source: string,
  ): 'written' | 'changed' | 'failed';
  restoreAtomicIfUnchanged?(
    path: string,
    expectedSource: string | null,
    source: string,
    retainPrevious: boolean,
    pendingOwnerPath: string,
  ): 'written' | 'changed' | 'failed';
  finalizePendingRecovery?(
    path: string,
    expectedSource: string,
    preparedPath: string,
    retirePrevious: boolean,
  ): 'finalized' | 'changed' | 'failed';
  removeDurable?(path: string): boolean;
};

const KNOWLEDGE_PATH_PREFIX = 'world/knowledge/';

/** One canonical page is one direct Markdown child of world/knowledge. */
export function isKnowledgeSourcePath(path: string): boolean {
  if (!path.startsWith(KNOWLEDGE_PATH_PREFIX) || path.includes('\\') || path.includes('\0')) return false;
  const name = path.slice(KNOWLEDGE_PATH_PREFIX.length);
  return !!name && !name.includes('/') && !name.includes('..') && /^[A-Za-z0-9][A-Za-z0-9._~-]*\.md$/.test(name);
}

export function sourceHash(source: string | null): string | null {
  return source === null ? null : sha256Hex(textBytes(source));
}

export function openKnowledgeSession(path: string, source: string): KnowledgeSession {
  const page = parseKnowledgePage(source, path);
  if (!page) throw new Error(`${path} does not contain one supported World Bible entity`);
  const hash = sourceHash(source);
  return {
    path,
    baseSource: source,
    baseHash: hash,
    basePage: page,
    diskSource: source,
    diskHash: hash,
    draft: draftFromPage(page),
  };
}

export function newKnowledgeSession(path: string, draft: KnowledgeDraft): KnowledgeSession {
  return {
    path,
    baseSource: null,
    baseHash: null,
    basePage: null,
    diskSource: null,
    diskHash: null,
    draft: cloneDraft(draft),
  };
}

export function cloneDraft(draft: KnowledgeDraft): KnowledgeDraft {
  return { ...draft, facts: draft.facts.map((fact) => ({ ...fact })) };
}

export function setKnowledgeDraft(session: KnowledgeSession, draft: KnowledgeDraft): KnowledgeSession {
  return { ...session, draft: cloneDraft(draft) };
}

export function refreshKnowledgeDisk(session: KnowledgeSession, currentSource: string | null): KnowledgeSession {
  return { ...session, diskSource: currentSource, diskHash: sourceHash(currentSource) };
}

export function knowledgeDraftChanged(session: KnowledgeSession): boolean {
  if (!session.basePage) return true;
  return semanticChanges(session.basePage, session.draft).length > 0;
}

export function knowledgeSourceState(session: KnowledgeSession): KnowledgeSourceState {
  const draftChanged = knowledgeDraftChanged(session);
  const diskChanged = session.diskHash !== session.baseHash;
  if (draftChanged && diskChanged) return 'CONFLICT';
  if (diskChanged) return 'DISK CHANGED';
  if (draftChanged) return 'DRAFT CHANGED';
  return 'DISK';
}

export function revertKnowledgeDraft(session: KnowledgeSession): KnowledgeSession {
  if (!session.basePage) return session;
  return { ...session, draft: draftFromPage(session.basePage) };
}

export function reloadKnowledgeFromDisk(session: KnowledgeSession): KnowledgeSession {
  if (session.diskSource === null) throw new Error(`${session.path} no longer exists on disk`);
  return openKnowledgeSession(session.path, session.diskSource);
}

function renderProposal(session: KnowledgeSession) {
  return session.basePage
    ? patchKnowledgePage(session.basePage, session.draft)
    : serializeNewKnowledgePage(session.path, session.draft);
}

type ProposalBody = Omit<KnowledgeWriteProposal, 'id'>;

function proposalDigest(proposal: ProposalBody | KnowledgeWriteProposal): string {
  return sha256Hex(textBytes(JSON.stringify({
    path: proposal.path,
    expectedDiskHash: proposal.expectedDiskHash,
    before: proposal.before,
    after: proposal.after,
    patch: proposal.patch,
    changes: proposal.changes,
    diagnostics: proposal.diagnostics,
  })));
}

function frozenProposal(body: ProposalBody): KnowledgeWriteProposal {
  const changes = Object.freeze(body.changes.map((change) => Object.freeze({ ...change })));
  const diagnostics = Object.freeze(body.diagnostics.map((item) => Object.freeze({ ...item })));
  const frozenBody = { ...body, changes, diagnostics };
  return Object.freeze({ id: proposalDigest(frozenBody), ...frozenBody });
}

export function prepareKnowledgeWrite(session: KnowledgeSession, currentDiskSource: string | null): PrepareResult {
  const refreshed = refreshKnowledgeDisk(session, currentDiskSource);
  const state = knowledgeSourceState(refreshed);
  if (!isKnowledgeSourcePath(refreshed.path)) {
    return { ok: false, session: refreshed, state, error: 'The proposed World Bible path is outside the canonical one-page directory.', diagnostics: [] };
  }
  if (refreshed.diskHash !== refreshed.baseHash) {
    return {
      ok: false,
      session: refreshed,
      state,
      error: state === 'CONFLICT'
        ? 'Both the draft and the canonical file changed. Reload or resolve the text outside the writer.'
        : 'The canonical file changed on disk. Reload it before preparing a write.',
      diagnostics: [],
    };
  }
  if (!knowledgeDraftChanged(refreshed)) {
    return { ok: false, session: refreshed, state, error: 'The draft matches disk; there is nothing to write.', diagnostics: [] };
  }
  const rendered = renderProposal(refreshed);
  if (!rendered.ok || !rendered.page) {
    return { ok: false, session: refreshed, state, error: 'The proposed source does not pass World Bible validation.', diagnostics: rendered.diagnostics };
  }
  const body: ProposalBody = {
    path: refreshed.path,
    expectedDiskHash: refreshed.baseHash,
    before: refreshed.baseSource,
    after: rendered.source,
    patch: sourcePatchPreview(refreshed.baseSource, rendered.source),
    changes: rendered.changes,
    diagnostics: rendered.diagnostics,
  };
  return {
    ok: true,
    session: refreshed,
    proposal: frozenProposal(body),
  };
}

export function confirmKnowledgeWrite(
  session: KnowledgeSession,
  proposal: KnowledgeWriteProposal,
  port: KnowledgeFilePort,
): ConfirmResult {
  if (!isKnowledgeSourcePath(session.path) || !isKnowledgeSourcePath(proposal.path) || proposal.path !== session.path) {
    return { ok: false, session, state: knowledgeSourceState(session), error: 'The proposal targets a different file.' };
  }
  if (proposal.id !== proposalDigest(proposal)) {
    return { ok: false, session, state: knowledgeSourceState(session), error: 'The reviewed proposal payload was altered. Nothing was written.' };
  }
  if (proposal.before !== session.baseSource || proposal.expectedDiskHash !== session.baseHash) {
    return { ok: false, session, state: knowledgeSourceState(session), error: 'The proposal no longer belongs to this loaded disk base.' };
  }
  const rerendered = renderProposal(session);
  if (!rerendered.ok || !rerendered.page
    || rerendered.source !== proposal.after
    || sourcePatchPreview(session.baseSource, rerendered.source) !== proposal.patch
    || JSON.stringify(rerendered.changes) !== JSON.stringify(proposal.changes)
    || JSON.stringify(rerendered.diagnostics) !== JSON.stringify(proposal.diagnostics)) {
    return { ok: false, session, state: knowledgeSourceState(session), error: 'The draft changed after review. Prepare a fresh exact patch.' };
  }
  const current = port.read(session.path);
  const refreshed = refreshKnowledgeDisk(session, current);
  if (sourceHash(current) !== proposal.expectedDiskHash) {
    return { ok: false, session: refreshed, state: knowledgeSourceState(refreshed), error: 'Canonical disk bytes changed after review. Nothing was written.' };
  }
  const reparsed = parseKnowledgePage(proposal.after, session.path);
  if (!reparsed || reparsed.diagnostics.some((item) => item.severity === 'error')) {
    return { ok: false, session: refreshed, state: knowledgeSourceState(refreshed), error: 'The reviewed proposal no longer parses cleanly.' };
  }
  const compareWrite = port.writeAtomicIfUnchanged
    ? port.writeAtomicIfUnchanged(session.path, proposal.before, proposal.after)
    : sourceHash(port.read(session.path)) !== proposal.expectedDiskHash
      ? 'changed'
      : port.writeAtomic(session.path, proposal.after) ? 'written' : 'failed';
  if (compareWrite === 'changed') {
    const changed = refreshKnowledgeDisk(refreshed, port.read(session.path));
    return { ok: false, session: changed, state: knowledgeSourceState(changed), error: 'Canonical disk bytes changed during the final expected-content check. Nothing was written.' };
  }
  if (compareWrite === 'failed') {
    const afterFailure = refreshKnowledgeDisk(refreshed, port.read(session.path));
    return {
      ok: false,
      session: afterFailure,
      state: knowledgeSourceState(afterFailure),
      error: afterFailure.diskSource === proposal.after
        ? 'Reviewed bytes reached canonical disk, but the durability check failed. Reload and verify before continuing.'
        : 'Atomic write failed; canonical disk bytes were not accepted.',
    };
  }
  const persisted = port.read(session.path);
  if (persisted !== proposal.after) {
    const afterFailure = refreshKnowledgeDisk(refreshed, persisted);
    return { ok: false, session: afterFailure, state: knowledgeSourceState(afterFailure), error: 'Write verification failed: disk does not contain the reviewed bytes.' };
  }
  const next = openKnowledgeSession(session.path, persisted);
  return { ok: true, session: next, page: next.basePage! };
}
