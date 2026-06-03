// perfLog — file-backed churn recorder for the hmsc-int paint-perf hunt.
//
// Painting on the 2D canvas chokes again. The paint path is supposed to be
// de-thrashed (chunk buffers in refs, per-chunk GPU re-upload, hover through a
// sink, the preview mirror THROTTLED to ~3/sec), but some recent change put the
// churn back. This module makes the churn visible: every suspect re-render,
// state bump, and heavy rebuild stamps a line into ONE log file you can tail.
//
//   tail -f /tmp/hmsc-int-churn.log
//
// console.log (severity 0) only lands in the in-memory ring, never the dev
// terminal (see memory console_log_severity_terminal), and a stream of warns
// would itself perturb the frame we're measuring — so this writes to disk
// instead: lines buffer in memory and flush on a short debounce, batched, so the
// logging never sits on the paint path.
//
// Pure diagnostics, no behavioural effect. Toggle live in the console with
// `hmsc_churnlog = false`. Rip the whole module + its call sites out once the
// choke is settled (grep `perfLog`).

import { useRef } from 'react';
import { writeFile } from '@reactjit/hooks/fs';

const LOG_PATH = '/tmp/hmsc-int-churn.log';
const MAX_TEXT = 600_000; // trim the on-disk file from the front past this
const FLUSH_MS = 250;     // debounce window — never sits on the paint path
const RING_MAX = 2000;    // recent lines kept in memory for the in-app /log route

const g: any = globalThis;
function now(): number { return g.performance?.now?.() ?? Date.now(); }
function enabled(): boolean { return g.hmsc_churnlog !== false; }

let fileText = '';
let buf: string[] = [];
let flushTimer: any = null;
let lastAt = 0;
let started = false;

// In-memory ring + subscribers: the /log route (LogView.tsx) reads the live log
// from here instead of the file, so you can read the churn trace inside the app.
const ring: string[] = [];
const logListeners = new Set<() => void>();
function notifyLog(): void { for (const cb of Array.from(logListeners)) { try { cb(); } catch {} } }

/** Subscribe to log updates (fires on each flush, ~4x/sec). Returns an unsubscribe. */
export function subscribeLog(cb: () => void): () => void { logListeners.add(cb); return () => { logListeners.delete(cb); }; }
/** The recent log lines (oldest→newest), for the in-app viewer. */
export function getLogLines(): string[] { return ring; }
/** Wipe the in-memory + on-disk log. */
export function clearLog(): void { ring.length = 0; buf = []; fileText = ''; try { writeFile(LOG_PATH, ''); } catch {} notifyLog(); }
/** Is churn logging on? (mirror of the `hmsc_churnlog` global.) */
export function isLoggingEnabled(): boolean { return enabled(); }
/** Turn churn logging on/off live (same as setting `hmsc_churnlog` in the console). */
export function setLoggingEnabled(on: boolean): void { g.hmsc_churnlog = on; notifyLog(); }
/** Where the on-disk copy lives (shown in the viewer). */
export function logFilePath(): string { return LOG_PATH; }

// One header per process so successive runs are separable in the same file.
function ensureStarted() {
  if (started) return;
  started = true;
  fileText = '';
  const stamp = new Date().toISOString?.() ?? String(Date.now());
  const header = `==== hmsc-int churn log · session start ${stamp} ====`;
  buf.push(header);
  ring.push(header);
  // Surface the path in the dev terminal (warn reaches stderr) so it's findable.
  try { console.warn(`[perfLog] churn log → ${LOG_PATH} (set hmsc_churnlog=false to stop)`); } catch {}
}

function flush() {
  flushTimer = null;
  if (!buf.length) return;
  fileText += buf.join('\n') + '\n';
  buf = [];
  if (fileText.length > MAX_TEXT) fileText = fileText.slice(fileText.length - MAX_TEXT);
  try { writeFile(LOG_PATH, fileText); } catch {}
  notifyLog(); // wake the in-app /log viewer
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

/** Stamp one line: `[t.t +Δms] tag: msg`. Δ = ms since the previous line. */
export function plog(tag: string, msg: string): void {
  if (!enabled()) return;
  ensureStarted();
  const t = now();
  const dt = lastAt ? t - lastAt : 0;
  lastAt = t;
  const line = `[${t.toFixed(1)} +${dt.toFixed(1)}] ${tag}: ${msg}`;
  buf.push(line);
  ring.push(line);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  scheduleFlush();
}

/** Time a synchronous block, log its duration under `label`, return its result. */
export function ptime<T>(tag: string, label: string, fn: () => T): T {
  if (!enabled()) return fn();
  const t0 = now();
  const r = fn();
  plog(tag, `${label} took ${(now() - t0).toFixed(2)}ms`);
  return r;
}

// A monotonic per-tag counter so render lines read "#37" without each call site
// threading its own ref.
const counters: Record<string, number> = {};
function bump(tag: string): number { return (counters[tag] = (counters[tag] ?? 0) + 1); }

/** Bump a named counter and return its new value (for call sites that print it). */
export function bumpCounter(tag: string): number { return bump(tag); }

/**
 * Snapshot all counters. Diff two snapshots to count how many UPDATES (component
 * re-renders) happened across a window — the per-stroke guard against the old
 * "one state update per painted tile" regression.
 */
export function countersSnapshot(): Record<string, number> { return { ...counters }; }
export function counterDelta(before: Record<string, number>, tag: string): number {
  return (counters[tag] ?? 0) - (before[tag] ?? 0);
}

/**
 * Log every render of a component and name which WATCHED values changed identity
 * since the last render — the direct answer to "what is re-rendering this, and
 * why". Pass the state/props you suspect drive the churn; Object.is identity is
 * the test (so a fresh array/object from a useMemo or setState counts as changed).
 */
export function useChurn(name: string, watched: Record<string, unknown>): void {
  const prev = useRef<Record<string, unknown> | null>(null);
  const n = bump(`render:${name}`);
  if (!enabled()) { prev.current = { ...watched }; return; }
  let detail = '';
  if (prev.current) {
    const changed: string[] = [];
    for (const k in watched) if (!Object.is(prev.current[k], watched[k])) changed.push(k);
    detail = changed.length ? ` changed:[${changed.join(',')}]` : ' (no watched change — parent re-rendered)';
  } else {
    detail = ' (first render)';
  }
  prev.current = { ...watched };
  plog('render', `${name} #${n}${detail}`);
}

/** A bare render counter for leaf components where the "why" doesn't matter yet. */
export function logRender(name: string): void {
  const n = bump(`render:${name}`);
  plog('render', `${name} #${n}`);
}
