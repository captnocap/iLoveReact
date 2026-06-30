// editor/data/journal.ts - build-journal snapshot backed by the real request
// ledger, not seeded editor fixtures.
import { useEffect, useState } from 'react';
import {
  BuildJournal,
  deriveBuildNumber,
  requestNumber,
  type BuildNote as JournalNote,
  type BugThread,
  type RequestEntry,
} from '../../../runtime/buildjournal';
import { listDir, readFile } from '../../../runtime/hooks/fs';
import type { BuildJournalSnapshot, BuildNote, BuildThread } from './types';

const REQUEST_LEDGER_DIR = 'docs/game/_requests';
const RECENT_NOTE_LIMIT = 48;

const EMPTY_SNAPSHOT: BuildJournalSnapshot = {
  activeBuild: '-',
  notes: [],
  threads: [],
  requestCount: 0,
  source: REQUEST_LEDGER_DIR,
  loadedAt: 'unavailable',
};

type LedgerEntry = RequestEntry & {
  sessionId?: string;
  captureMode?: string;
  status?: string;
};

export function loadBuildJournalSnapshot(): BuildJournalSnapshot {
  const filenames = listDir(REQUEST_LEDGER_DIR)
    .filter((name) => /^req_\d+\.json$/.test(name))
    .sort((a, b) => requestNumber(requestIdFromFilename(b)) - requestNumber(requestIdFromFilename(a)));

  if (filenames.length === 0) {
    return { ...EMPTY_SNAPSHOT, loadedAt: timestampLabel() };
  }

  const entries = filenames
    .slice(0, RECENT_NOTE_LIMIT)
    .map(readLedgerEntry)
    .filter(Boolean) as LedgerEntry[];

  const journal = new BuildJournal();
  const journalNotes = new Map<string, JournalNote>();
  for (const entry of entries) {
    const note = journal.ingestRequest(entry);
    journalNotes.set(entry.id, note);
  }

  return {
    activeBuild: deriveBuildNumber(requestIdFromFilename(filenames[0]!)),
    notes: entries.map((entry) => toEditorNote(entry, journalNotes.get(entry.id)!)),
    threads: journal.threads().map(toEditorThread),
    requestCount: filenames.length,
    source: REQUEST_LEDGER_DIR,
    loadedAt: timestampLabel(),
  };
}

export function useBuildJournalSnapshot(): BuildJournalSnapshot {
  const [snapshot, setSnapshot] = useState<BuildJournalSnapshot>(loadBuildJournalSnapshot);

  useEffect(() => {
    setSnapshot(loadBuildJournalSnapshot());
  }, []);

  return snapshot;
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

function toEditorNote(entry: LedgerEntry, note: JournalNote): BuildNote {
  return {
    request: entry.id,
    build: note.buildId,
    title: titleFor(entry, note),
    status: statusFor(entry),
    agent: note.agent,
    handled: note.summary,
    trace: traceFor(entry, note),
  };
}

function toEditorThread(thread: BugThread): BuildThread {
  return {
    id: thread.stableId,
    title: thread.semanticName,
    status: thread.tags[0] ?? 'linked',
    history: [
      ...thread.linkedRequests,
      ...thread.linkedBuilds,
      ...thread.attachedCaptures,
    ],
  };
}

function titleFor(entry: LedgerEntry, note: JournalNote): string {
  const taskSummary = tagValue(entry.text, 'summary');
  const line = taskSummary || firstUsefulLine(entry.text) || firstUsefulLine(note.summary);
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

function requestIdFromFilename(filename: string): string {
  return filename.replace(/\.json$/, '');
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
