// editor/data/journal.ts - build-journal snapshot backed by the real request
// ledger, with durable, user-editable bug threads layered on top.
//
// Build NOTES re-derive from docs/game/_requests/req_*.json on every load (the
// ledger is read-only source data). Bug THREADS — the links that turn deliveries
// into ongoing history — are mutable and persisted via journalStore. The hook
// returns a snapshot plus the actions the Build Journal dialog drives.
import { useRef, useState } from 'react';
import {
  BuildJournal,
  type BuildNote as JournalNote,
  type BugThread,
  type LogCapture,
  type RequestEntry,
} from '../../../runtime/buildjournal';
import { listDir, readFile } from '../../../runtime/hooks/fs';
import { CAPTURE_SHELF, loadThreadState, saveThreadState } from './journalStore';
import type { BuildJournalSnapshot, BuildNote, BuildThread, JournalCapture, ThreadAttempt } from './types';

const REQUEST_LEDGER_DIR = 'docs/game/_requests';
const RECENT_NOTE_LIMIT = 48;

type LedgerEntry = RequestEntry & {
  sessionId?: string;
  captureMode?: string;
  status?: string;
};

/** Everything a snapshot is derived from: the live journal (notes + mutable
 *  threads) plus the ledger context the editor notes need for titles/tags. */
interface LedgerContext {
  journal: BuildJournal;
  entriesById: Map<string, LedgerEntry>;
  requestCount: number;
  deliveryCount: number;
  source: string;
  loadedAt: string;
}

/** The mutations the Build Journal dialog can drive. Each one edits the live
 *  journal, persists the durable thread state, and refreshes the snapshot. */
export interface JournalActions {
  createThreadFromRequest(requestId: string, name: string): void;
  attachRequest(threadId: string, requestId: string): void;
  detachRequest(threadId: string, requestId: string): void;
  renameThread(threadId: string, name: string): void;
  setDescription(threadId: string, description: string): void;
  attachCapture(threadId: string, captureId: string): void;
  detachCapture(threadId: string, captureId: string): void;
  rateAttempt(threadId: string, requestId: string, rating: number): void;
  crownGospel(threadId: string, requestId: string): void;
  uncrownGospel(threadId: string): void;
  captureShelf: JournalCapture[];
}

function loadLedgerContext(): LedgerContext {
  const filenames = listDir(REQUEST_LEDGER_DIR)
    .filter((name) => /^req_\d+\.json$/.test(name))
    .sort((a, b) => requestNumber(b) - requestNumber(a));

  const journal = new BuildJournal();
  const entriesById = new Map<string, LedgerEntry>();
  const entries = collectRecentEntries(filenames);
  for (const entry of entries) {
    entriesById.set(entry.id, entry);
    journal.ingestRequest(entry);
  }

  // Institutional memory: a thread must carry full context for EVERY recurrence
  // it links, even ones older than the recent window. Read + ingest any linked
  // request that the recent sweep missed, so an old attempt still shows its ask,
  // claim, and commits instead of a bare id. This is the whole point of a thread.
  const threadState = loadThreadState();
  for (const thread of threadState.threads) {
    for (const requestId of thread.linkedRequests) {
      if (entriesById.has(requestId)) continue;
      const entry = readLedgerEntry(`${requestId}.json`);
      if (entry) {
        entriesById.set(entry.id, entry);
        journal.ingestRequest(entry);
      }
    }
  }

  // Captures must be registered before hydrating threads so capture→note
  // mirroring can resolve; then persisted thread links re-wire the back-refs.
  for (const capture of CAPTURE_SHELF) journal.registerCapture(capture);
  journal.importThreadState(threadState);

  return {
    journal,
    entriesById,
    requestCount: filenames.length,
    deliveryCount: entries.length,
    source: REQUEST_LEDGER_DIR,
    loadedAt: timestampLabel(),
  };
}

function deriveSnapshot(ctx: LedgerContext): BuildJournalSnapshot {
  const journal = ctx.journal;
  return {
    activeBuild: journal.latestBuildNumber() ?? '-',
    notes: journal
      .notes()
      .map((note) => {
        const entry = ctx.entriesById.get(note.requestId);
        return entry ? toEditorNote(entry, note) : null;
      })
      .filter(Boolean) as BuildNote[],
    threads: journal.threads().map((thread) => toEditorThread(thread, journal)),
    requestCount: ctx.requestCount,
    deliveryCount: ctx.deliveryCount,
    source: ctx.source,
    loadedAt: ctx.loadedAt,
  };
}

/** The live build journal: a snapshot of notes + threads, and the actions that
 *  mutate threads. Mutations persist to disk so threads survive across sessions. */
export function useBuildJournal(): { snapshot: BuildJournalSnapshot; actions: JournalActions } {
  const ctxRef = useRef<LedgerContext | null>(null);
  if (!ctxRef.current) ctxRef.current = loadLedgerContext();
  const [snapshot, setSnapshot] = useState<BuildJournalSnapshot>(() => deriveSnapshot(ctxRef.current!));

  const commit = () => {
    const ctx = ctxRef.current!;
    saveThreadState(ctx.journal.exportThreadState());
    setSnapshot(deriveSnapshot(ctx));
  };

  const actions: JournalActions = {
    createThreadFromRequest(requestId, name) {
      const journal = ctxRef.current!.journal;
      const thread = journal.createThread({ semanticName: name.trim() || requestId });
      if (requestId) journal.attachToThread(thread.stableId, { requestId });
      commit();
    },
    attachRequest(threadId, requestId) {
      ctxRef.current!.journal.attachToThread(threadId, { requestId });
      commit();
    },
    detachRequest(threadId, requestId) {
      ctxRef.current!.journal.detachFromThread(threadId, { requestId });
      commit();
    },
    renameThread(threadId, name) {
      const next = name.trim();
      if (!next) return;
      ctxRef.current!.journal.renameThread(threadId, next);
      commit();
    },
    setDescription(threadId, description) {
      ctxRef.current!.journal.describeThread(threadId, description.trim());
      commit();
    },
    attachCapture(threadId, captureId) {
      ctxRef.current!.journal.attachToThread(threadId, { captureId });
      commit();
    },
    detachCapture(threadId, captureId) {
      ctxRef.current!.journal.detachFromThread(threadId, { captureId });
      commit();
    },
    rateAttempt(threadId, requestId, rating) {
      ctxRef.current!.journal.rateAttempt(threadId, requestId, rating);
      commit();
    },
    crownGospel(threadId, requestId) {
      ctxRef.current!.journal.crownGospel(threadId, requestId);
      commit();
    },
    uncrownGospel(threadId) {
      ctxRef.current!.journal.uncrownGospel(threadId);
      commit();
    },
    captureShelf: CAPTURE_SHELF.map(toDisplayCapture),
  };

  return { snapshot, actions };
}

function readLedgerEntry(filename: string): LedgerEntry | null {
  const raw = readFile(`${REQUEST_LEDGER_DIR}/${filename}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LedgerEntry>;
    if (typeof parsed.id !== 'string' || typeof parsed.text !== 'string') return null;
    return {
      ...parsed,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    } as LedgerEntry;
  } catch {
    return null;
  }
}

function collectRecentEntries(filenames: string[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const filename of filenames) {
    const entry = readLedgerEntry(filename);
    if (entry) entries.push(entry); // EVERY prompt is a note, resolved or not
    if (entries.length >= RECENT_NOTE_LIMIT) break;
  }
  return entries;
}

function toEditorNote(entry: LedgerEntry, note: JournalNote): BuildNote {
  return {
    request: entry.id,
    build: note.buildId,
    title: titleFor(entry, note),
    status: statusFor(entry),
    agent: note.agent,
    ask: compact(firstUsefulLine(entry.text) || entry.id, 110),
    claim: note.summary,
    commits: [...note.commits],
    trace: traceFor(entry, note),
    threadIds: [...note.threadIds],
  };
}

/** A thread's linked requests, resolved to ranked attempts and sorted so the
 *  needle floats up: the gospel first, then by rating desc, then newest request.
 *  This is what makes a recurrence readable at a glance — the fix that worked
 *  sits on top of the dozen that didn't. */
function rankedAttempts(thread: BugThread, journal: BuildJournal): ThreadAttempt[] {
  const attempts = thread.linkedRequests.map((requestId): ThreadAttempt => {
    const note = journal.noteByRequest(requestId);
    return {
      request: requestId,
      build: note?.buildId ?? '',
      ask: note ? compact(firstUsefulLine(note.ask) || requestId, 120) : requestId,
      claim: note?.summary ?? '',
      agent: note?.agent ?? 'unknown',
      status: note?.status ?? 'new',
      commits: note ? [...note.commits] : [],
      rating: thread.ratings[requestId] ?? 0,
      gospel: thread.gospel === requestId,
    };
  });
  return attempts.sort((a, b) => {
    if (a.gospel !== b.gospel) return a.gospel ? -1 : 1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return requestNumber(b.request) - requestNumber(a.request);
  });
}

function toEditorThread(thread: BugThread, journal: BuildJournal): BuildThread {
  const attempts = rankedAttempts(thread, journal);
  return {
    id: thread.stableId,
    title: thread.semanticName,
    description: thread.description,
    status: thread.tags[0] ?? 'linked',
    aliases: [...thread.aliases],
    tags: [...thread.tags],
    attempts,
    captures: journal.capturesForThread(thread.stableId).map(toDisplayCapture),
    history: [...thread.linkedBuilds],
    commitsBurned: attempts.reduce((sum, a) => sum + a.commits.length, 0),
    hasGospel: thread.gospel !== '',
  };
}

function toDisplayCapture(capture: LogCapture): JournalCapture {
  const { start, end } = capture.timeRange;
  return {
    id: capture.id,
    name: capture.name,
    channels: [...capture.channels],
    range: start === 0 && end === 0 ? 'pending capture' : `${start}-${end}`,
    build: capture.buildId,
    context: capture.mapContext,
    note: capture.note,
  };
}

function titleFor(entry: LedgerEntry, note: JournalNote): string {
  const line = firstUsefulLine(note.summary) || tagValue(entry.text, 'summary');
  return compact(line || entry.id, 92);
}

function statusFor(entry: LedgerEntry): string {
  if (entry.status) return entry.status;
  const events = entry.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.kind === 'state' && event.to) return event.to;
  }
  return entry.resolution ? 'resolved' : 'unknown';
}

function traceFor(entry: LedgerEntry, note: JournalNote): string[] {
  const tags = new Set<string>();
  for (const tag of note.traceTags) tags.add(tag);
  if (entry.at) tags.add(dayLabel(entry.at));
  if (entry.origin) tags.add(`origin:${entry.origin.split(':')[0]}`);
  if (entry.shas?.length) tags.add(`${entry.shas.length} sha${entry.shas.length === 1 ? '' : 's'}`);
  for (const event of entry.events ?? []) {
    if (event.kind === 'state' && event.from && event.to) tags.add(`${event.from}->${event.to}`);
  }
  return Array.from(tags).slice(0, 6);
}

function firstUsefulLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('<')) ?? '';
}

function tagValue(value: string, tag: string): string {
  const match = value.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function compact(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, Math.max(0, max - 3)).trim()}...` : oneLine;
}

function requestNumber(filename: string): number {
  const match = filename.match(/(\d+)/);
  return match ? parseInt(match[1]!, 10) : 0;
}

function timestampLabel(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function dayLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
