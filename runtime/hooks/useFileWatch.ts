/**
 * useFileWatch — fires `handler(event)` when a watched file/dir changes.
 * Bridges framework/fswatch.zig (engine-driven snapshot diff with min 100ms
 * interval).
 *
 * Usage:
 *   useFileWatch('config.json', (e) => {
 *     if (e.type === 'modified') reloadConfig();
 *   });
 *
 *   useFileWatch('./src', (e) => doSomething(e), {
 *     recursive: true,
 *     pattern: '*.tsx',
 *     intervalMs: 200,
 *   });
 *
 * Multiple hooks can watch independently; a singleton manager drains
 * the global event queue and dispatches to the right subscriber by
 * watcher_id.
 */

import { useEffect, useRef } from 'react';
import { registerIfttSource } from './ifttt-registry';

const host = (): any => globalThis as any;

export interface FileWatchEvent {
  watcherId: number;
  type: 'created' | 'modified' | 'deleted';
  path: string;
  size: number;
  mtimeNs: number;
}

export interface FileWatchOptions {
  recursive?: boolean;
  intervalMs?: number;
  pattern?: string;
}

// ── Singleton manager ──────────────────────────────────────
//
// One drain timer for the whole app, regardless of how many useFileWatch
// hooks are active. Events are queued in Zig and fanned out here by
// watcher_id.

type Listener = (event: FileWatchEvent) => void;

const listeners = new Map<number, Listener>();
let drainTimer: any = null;

function ensureDrainTimer(): void {
  if (drainTimer != null) return;
  // 100ms — matches the lower bound the Zig watcher enforces, so we never
  // poll faster than events can arrive.
  drainTimer = setInterval(() => {
    if (listeners.size === 0) return;
    const raw: string = host().__fswatchDrain?.() ?? '[]';
    if (!raw || raw === '[]') return;
    let events: any[] = [];
    try { events = JSON.parse(raw); } catch { return; }
    for (const ev of events) {
      const fn = listeners.get(ev.w);
      if (fn) fn({ watcherId: ev.w, type: ev.t, path: ev.p, size: ev.s, mtimeNs: ev.m });
    }
  }, 100);
}

function stopDrainTimerIfIdle(): void {
  if (listeners.size > 0) return;
  if (drainTimer != null) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}

export function useFileWatch(
  path: string,
  handler: (event: FileWatchEvent) => void,
  opts: FileWatchOptions = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const off = attachWatcher(path, (ev) => handlerRef.current(ev), opts);
    return off;
  }, [path, opts.recursive, opts.intervalMs, opts.pattern]);
}

// ── Imperative attach (no React) ───────────────────────────────────
//
// Same singleton drain machinery, exposed for callers that don't have a
// React render lifecycle — primarily the IFTTT registry below.

export function attachWatcher(
  path: string,
  fn: Listener,
  opts: FileWatchOptions = {},
): () => void {
  if (!path) return () => {};
  const id: number = host().__fswatchAdd?.(
    path,
    opts.recursive ? 1 : 0,
    opts.intervalMs ?? 1000,
    opts.pattern ?? '',
  ) ?? -1;
  if (id < 0) return () => {};
  listeners.set(id, fn);
  ensureDrainTimer();
  return () => {
    host().__fswatchRemove?.(id);
    listeners.delete(id);
    stopDrainTimerIfIdle();
  };
}

// ── IFTTT registration ─────────────────────────────────────────────
//
// 'fs:changed:<path>'   modified events under <path> (recursive).
// 'fs:created:<path>'   created events.
// 'fs:deleted:<path>'   deleted events.
// 'fs:any:<path>'       all event types.
//
// Path is the watch root — pass a directory for recursive watching, a
// file for single-file. `pattern` glob is not exposed in the DSL today;
// add `:pattern=*.tsx` later if needed without breaking the prefix.

function registerFsSource(prefix: string, filter: FileWatchEvent['type'] | null): void {
  registerIfttSource(prefix, {
    match(spec) {
      if (!spec.startsWith(prefix)) return null;
      const path = spec.slice(prefix.length);
      if (!path) return null;
      return {
        subscribe(onFire) {
          return attachWatcher(path, (ev) => {
            if (filter && ev.type !== filter) return;
            onFire(ev);
          }, { recursive: true });
        },
      };
    },
  });
}

registerFsSource('fs:changed:', 'modified');
registerFsSource('fs:created:', 'created');
registerFsSource('fs:deleted:', 'deleted');
registerFsSource('fs:any:', null);
