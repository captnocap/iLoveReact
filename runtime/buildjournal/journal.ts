// buildjournal/journal.ts — the journal model: ingest, threads, attach, search.
//
// One in-memory authority over the three records (types.ts). It is the deep
// module behind the eventual clickable build-number dialog; this task is the
// data model + pure logic only (no UI). Everything is keyed by stable id, so the
// renaming-must-not-break-links rule falls out for free: rename only edits a
// display string, never a key.

import type { BuildNote, BugThread, LogCapture, RequestEntry, ThreadLink } from './types';
import { deriveBuildNumber } from './buildNumber';

/** Options when minting a new bug thread. Only the name is required. */
export interface NewThread {
  semanticName: string;
  aliases?: string[];
  tags?: string[];
  searchTokens?: string[];
}

/** Lowercase, split on non-alphanumerics, drop empties — the one tokenizer used
 *  for both indexing and querying so they always agree. */
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

/** Add a value to an array iff absent (links are sets; order is insertion). */
function addUnique(arr: string[], v: string): void {
  if (v && !arr.includes(v)) arr.push(v);
}

/** Pick the handling agent from a ledger entry: the actor of the last state
 *  transition, else the origin, else 'unknown'. */
function agentOf(entry: RequestEntry): string {
  const states = (entry.events ?? []).filter((e) => e.kind === 'state' && e.actor);
  if (states.length) return states[states.length - 1]!.actor!;
  return entry.origin || 'unknown';
}

export class BuildJournal {
  private notesByRequest = new Map<string, BuildNote>();
  private threadsById = new Map<string, BugThread>();
  private capturesById = new Map<string, LogCapture>();
  private threadSeq = 0;

  // ── ingest: request ledger → build notes ───────────────────────────────────

  /** Ingest one request-ledger entry into a BuildNote (idempotent by request id;
   *  re-ingesting refreshes the derived fields but preserves accumulated links). */
  ingestRequest(entry: RequestEntry): BuildNote {
    const existing = this.notesByRequest.get(entry.id);
    const note: BuildNote = {
      requestId: entry.id,
      buildId: deriveBuildNumber(entry.id),
      agent: agentOf(entry),
      summary: (entry.resolution && entry.resolution.trim()) || entry.text,
      traceTags: existing?.traceTags ?? [],
      threadIds: existing?.threadIds ?? [],
      captureIds: existing?.captureIds ?? [],
    };
    this.notesByRequest.set(entry.id, note);
    return note;
  }

  /** Ingest a batch of ledger entries. */
  ingestRequests(entries: RequestEntry[]): BuildNote[] {
    return entries.map((e) => this.ingestRequest(e));
  }

  /** A build note by its source request id. */
  noteByRequest(requestId: string): BuildNote | undefined {
    return this.notesByRequest.get(requestId);
  }

  /** A build note by its derived build number. */
  noteByBuild(buildId: string): BuildNote | undefined {
    for (const n of this.notesByRequest.values()) if (n.buildId === buildId) return n;
    return undefined;
  }

  /** All build notes, newest request first (the journal stream order). */
  notes(): BuildNote[] {
    return Array.from(this.notesByRequest.values()).sort(
      (a, b) => requestRank(b.requestId) - requestRank(a.requestId),
    );
  }

  /** The highest build-number stream value seen — what the bottom dock shows. */
  latestBuildNumber(): string | undefined {
    return this.notes()[0]?.buildId;
  }

  // ── captures ───────────────────────────────────────────────────────────────

  /** Register a diagnostic capture so threads/notes can reference it by id. */
  registerCapture(capture: LogCapture): LogCapture {
    this.capturesById.set(capture.id, capture);
    return capture;
  }

  /** A capture by id. */
  capture(id: string): LogCapture | undefined {
    return this.capturesById.get(id);
  }

  /** Captures attached to a thread, resolved to records (skips dangling ids). */
  capturesForThread(stableId: string): LogCapture[] {
    const t = this.threadsById.get(stableId);
    if (!t) return [];
    return t.attachedCaptures.map((id) => this.capturesById.get(id)).filter(Boolean) as LogCapture[];
  }

  // ── bug threads ─────────────────────────────────────────────────────────────

  /** Mint a new bug thread with a stable id. The semantic name is for humans;
   *  the stable id is what every link points at. */
  createThread(spec: NewThread): BugThread {
    const stableId = `thread_${String(++this.threadSeq).padStart(4, '0')}`;
    const thread: BugThread = {
      stableId,
      semanticName: spec.semanticName,
      aliases: spec.aliases ? [...spec.aliases] : [],
      tags: spec.tags ? [...spec.tags] : [],
      searchTokens: spec.searchTokens ? [...spec.searchTokens] : [],
      attachedCaptures: [],
      linkedRequests: [],
      linkedBuilds: [],
    };
    this.threadsById.set(stableId, thread);
    return thread;
  }

  /** Rename a thread. The stable id and ALL links are preserved; the old name is
   *  kept as an alias so a remembered label still finds the thread later. */
  renameThread(stableId: string, newName: string): BugThread {
    const t = this.threadsById.get(stableId);
    if (!t) throw new Error(`buildjournal: no thread '${stableId}' to rename`);
    const old = t.semanticName;
    if (old && old !== newName) addUnique(t.aliases, old);
    t.semanticName = newName;
    return t;
  }

  /** A thread by stable id. */
  thread(stableId: string): BugThread | undefined {
    return this.threadsById.get(stableId);
  }

  /** All threads (creation order). */
  threads(): BugThread[] {
    return Array.from(this.threadsById.values());
  }

  // ── attach: wire history onto a thread (bidirectional) ──────────────────────

  /** Attach a request, build, and/or capture to a thread's history. Whichever
   *  of the three is supplied is linked; the back-reference on the matching
   *  build note is kept in sync so the link is traversable from either side. */
  attachToThread(stableId: string, link: ThreadLink): BugThread {
    const t = this.threadsById.get(stableId);
    if (!t) throw new Error(`buildjournal: no thread '${stableId}' to attach to`);

    if (link.requestId) {
      addUnique(t.linkedRequests, link.requestId);
      const note = this.notesByRequest.get(link.requestId);
      if (note) {
        addUnique(note.threadIds, stableId);
        addUnique(t.linkedBuilds, note.buildId); // a request carries its build
      }
    }
    if (link.buildId) {
      addUnique(t.linkedBuilds, link.buildId);
      const note = this.noteByBuild(link.buildId);
      if (note) addUnique(note.threadIds, stableId);
    }
    if (link.captureId) {
      addUnique(t.attachedCaptures, link.captureId);
      // mirror onto the note for the capture's build, if we have it
      const cap = this.capturesById.get(link.captureId);
      const note = cap ? this.noteByBuild(cap.buildId) : undefined;
      if (note) addUnique(note.captureIds, link.captureId);
    }
    return t;
  }

  // ── semantic search ─────────────────────────────────────────────────────────

  /** Find threads matching a query over name + aliases + tags + searchTokens.
   *  Ranked: an exact (case-insensitive) name match ranks first, then exact
   *  alias, then substring-of-name, then per-token overlap. Returns only scoring
   *  threads, best first. This powers "attach to existing bug" by remembered name. */
  findThreads(query: string): BugThread[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qTokens = tokenize(q);
    const scored: Array<{ t: BugThread; score: number }> = [];

    for (const t of this.threadsById.values()) {
      const name = t.semanticName.toLowerCase();
      const aliases = t.aliases.map((a) => a.toLowerCase());
      let score = 0;

      if (name === q) score += 1000;
      else if (aliases.includes(q)) score += 500;
      else if (name.includes(q)) score += 100;

      // per-token overlap against the thread's full searchable surface
      const surface = new Set<string>([
        ...tokenize(t.semanticName),
        ...t.aliases.flatMap(tokenize),
        ...t.tags.flatMap(tokenize),
        ...t.searchTokens.flatMap(tokenize),
      ]);
      for (const tok of qTokens) if (surface.has(tok)) score += 10;

      if (score > 0) scored.push({ t, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.t);
  }
}

/** Sort key for journal stream order — the request counter, descending-friendly. */
function requestRank(requestId: string): number {
  const m = requestId.match(/(\d+)\s*$/);
  return m ? parseInt(m[1]!, 10) : 0;
}
