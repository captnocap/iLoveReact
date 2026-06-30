// diag/console/feed.ts — the live diagnostics feed the console reads.
//
// The host (framework/diag/diag_registry.zig) re-broadcasts every accepted line
// on the `diag.feed` ffi channel; this module subscribes ONCE, keeps a bounded
// in-memory ring, and exposes it through useSyncExternalStore so the console
// re-renders as lines land. On first subscribe it seeds from the host's own
// ring via `__diag_recent` so a freshly-opened console isn't blank.
//
// Pause/resume freezes the PUBLISHED view without dropping data — lines keep
// landing in the live ring, and resume republishes it. Nothing here implements
// a diagnostics system; it is the read side of the registry contract.

import { subscribe as ffiSubscribe, callHost } from '../../ffi';

/** Kept in lockstep with diag_registry.zig `DIAG_FEED_CHANNEL`. */
export const DIAG_FEED_CHANNEL = 'diag.feed';

/** One feed line — the row contract the registry serializes (writeEntryJson). */
export interface DiagLine {
  seq: number;
  ts: number;
  /** channel id, e.g. 'editor.place'. */
  ch: string;
  /** severity wire string. */
  sev: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  /** structured payload (already an object once parsed). */
  fields: Record<string, unknown>;
  /** 1 when the host truncated an oversized msg/fields. */
  trunc?: number;
}

/** Per-channel host-side state from `__diag_channels_state` (dropped counts). */
export interface DiagChannelState {
  id: string;
  enabled: boolean;
  sampleDiv: number;
  emitted: number;
  dropped: number;
}

const MAX_LINES = 4000;

let _live: DiagLine[] = [];
let _version = 0;
let _cacheVersion = -1;
let _cache: DiagLine[] = [];
let _paused = false;
let _frozen: DiagLine[] = [];
let _wired = false;

const _listeners = new Set<() => void>();

function notify(): void {
  for (const l of _listeners) l();
}

function normalize(raw: any): DiagLine | null {
  if (!raw || typeof raw !== 'object') return null;
  let fields = raw.fields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch { fields = { _raw: raw.fields }; }
  }
  if (!fields || typeof fields !== 'object') fields = {};
  return {
    seq: Number(raw.seq) || 0,
    ts: Number(raw.ts) || 0,
    ch: String(raw.ch ?? ''),
    sev: (raw.sev ?? 'info') as DiagLine['sev'],
    msg: String(raw.msg ?? ''),
    fields,
    trunc: raw.trunc ? 1 : 0,
  };
}

function ingest(line: DiagLine): void {
  _live.push(line);
  if (_live.length > MAX_LINES) _live.splice(0, _live.length - MAX_LINES);
  _version++;
  if (!_paused) notify();
}

/** A feed payload arrives as the parsed JSON line (ffi delivers the string;
 *  __ffiEmit forwards exactly what the sink wrote). Accept both string + object
 *  so the path is robust to either transport. */
function onFeedPayload(payload: any): void {
  let obj = payload;
  if (typeof payload === 'string') {
    try { obj = JSON.parse(payload); } catch { return; }
  }
  const line = normalize(obj);
  if (line) ingest(line);
}

/** Seed from the host ring so the console opens populated. Safe no-op when the
 *  door isn't wired yet (graceful degrade — the TS console builds + runs before
 *  the Zig lands). */
function seedFromHost(): void {
  const raw = callHost<string>('__diag_recent', '[]', MAX_LINES);
  let arr: any[];
  try { arr = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(arr)) return;
  for (const r of arr) {
    const line = normalize(r);
    if (line) _live.push(line);
  }
  if (_live.length > MAX_LINES) _live.splice(0, _live.length - MAX_LINES);
  _version++;
}

function ensureWired(): void {
  if (_wired) return;
  _wired = true;
  seedFromHost();
  ffiSubscribe(DIAG_FEED_CHANNEL, onFeedPayload);
}

// ── External store API (for useSyncExternalStore) ───────────────────────────

export function subscribeFeed(fn: () => void): () => void {
  ensureWired();
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export function feedSnapshot(): DiagLine[] {
  if (_paused) return _frozen;
  if (_cacheVersion !== _version) {
    _cache = _live.slice();
    _cacheVersion = _version;
  }
  return _cache;
}

// ── Controls ────────────────────────────────────────────────────────────────

export function isPaused(): boolean {
  return _paused;
}

export function pauseFeed(): void {
  if (_paused) return;
  // Freeze the current view, then stop publishing (data still ingests).
  _frozen = feedSnapshot();
  _paused = true;
  notify();
}

export function resumeFeed(): void {
  if (!_paused) return;
  _paused = false;
  notify();
}

export function togglePause(): void {
  if (_paused) resumeFeed(); else pauseFeed();
}

export function clearFeed(): void {
  _live = [];
  _frozen = [];
  _version++;
  _cacheVersion = -1;
  notify();
}

/** Live host channel state (dropped counts for sampled channels). Empty when
 *  the door isn't wired. */
export function channelStates(): DiagChannelState[] {
  const raw = callHost<string>('__diag_channels_state', '[]');
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
