// Canvas snapshot history.
//
// A linear chain of committed snapshots, ring-buffered to the last
// HISTORY_MAX entries. The chain has a current `index` pointer
// (head = chain.length - 1 by default). Undo decrements the index;
// redo increments. New commits made while not at head TRUNCATE the
// forward chain — same semantics as a git branch from a checkout.
//
// Why localStorage and not useCRUD/pg: this is shape-finding scratch
// (per project memory), and snapshots are tiny (a few hundred bytes
// each). localStorage gives us across-reload persistence without a
// migration. If we want server-shared history later, we lift the
// shape into a useCRUD entity — the data shape stays the same.

import type { CanvasSnapshot } from './tools';

const HISTORY_KEY = 'canvas_history_v0';
const HISTORY_INDEX_KEY = 'canvas_history_index_v0';
export const HISTORY_MAX = 100;

export interface HistoryEntry {
  /** ULID-shaped id: `Date.now()` base36 + 6 random base36. */
  id: string;
  /** Commit timestamp in ms. */
  ts: number;
  /** The committed state snapshot. */
  snapshot: CanvasSnapshot;
  /** Who made the commit — relevant for the history UI later. */
  author: 'user' | 'assistant';
  /** Free-text summary written by whichever path produced the entry
   *  (e.g. "drag bag panel", "stage-accept: 3 ops"). */
  summary: string;
  /** Previous entry id, or null for the first commit. Lets a future
   *  UI render a tree even though we currently only ever traverse
   *  linearly. */
  parent: string | null;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = (globalThis as any).localStorage?.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch { return fallback; }
}
function save(key: string, value: any): void {
  try { (globalThis as any).localStorage?.setItem(key, JSON.stringify(value)); }
  catch { /* ignore */ }
}

export function loadHistory(): HistoryEntry[] {
  const raw = load<HistoryEntry[]>(HISTORY_KEY, []);
  return Array.isArray(raw) ? raw : [];
}
export function loadHistoryIndex(): number {
  const raw = load<number>(HISTORY_INDEX_KEY, -1);
  return typeof raw === 'number' && Number.isInteger(raw) ? raw : -1;
}
export function saveHistory(chain: HistoryEntry[], index: number): void {
  save(HISTORY_KEY, chain);
  save(HISTORY_INDEX_KEY, index);
}

function newId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 1e9).toString(36).padStart(6, '0').slice(0, 6);
  return `snap_${ts}_${rnd}`;
}

/** Append a new entry. Truncates anything after `index` first
 *  (forward chain is invalidated by a new commit). Returns the new
 *  chain + index. Caller is responsible for persisting. */
export function pushEntry(
  chain: HistoryEntry[],
  index: number,
  snapshot: CanvasSnapshot,
  author: 'user' | 'assistant',
  summary: string,
): { chain: HistoryEntry[]; index: number } {
  const truncated = chain.slice(0, index + 1);
  const parent = truncated.length > 0 ? truncated[truncated.length - 1].id : null;
  const entry: HistoryEntry = {
    id: newId(), ts: Date.now(), snapshot, author, summary, parent,
  };
  const next = [...truncated, entry];
  // Ring-buffer cap. Drop oldest when over.
  while (next.length > HISTORY_MAX) next.shift();
  return { chain: next, index: next.length - 1 };
}

/** Two snapshots are considered equal for dedupe purposes if the
 *  important fields match. Used to skip pushes from no-op commits
 *  (debounced fires that didn't change anything). */
export function snapshotsEqual(a: CanvasSnapshot, b: CanvasSnapshot): boolean {
  if (a.slots.length !== b.slots.length) return false;
  for (let i = 0; i < a.slots.length; i++) if (a.slots[i] !== b.slots[i]) return false;
  if (a.panels.length !== b.panels.length) return false;
  for (let i = 0; i < a.panels.length; i++) {
    const x = a.panels[i], y = b.panels[i];
    if (x.id !== y.id || x.anchor !== y.anchor || x.hidden !== y.hidden) return false;
    if (x.offset.x !== y.offset.x || x.offset.y !== y.offset.y) return false;
    if (x.span.w !== y.span.w || x.span.h !== y.span.h) return false;
  }
  return true;
}
