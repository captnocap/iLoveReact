// eventBus.ts — cart-facing wrapper for the Zig observability bus.
//
// All cart code that emits diagnostics goes through here. Direct
// __busEmit calls are not forbidden but the wrapper handles JSON
// serialization, missing-host guarding, and importance overrides so
// callers don't have to care.
//
// The bus is FIRE AND FORGET. emit() never throws and never blocks.
// If the host fns aren't installed (cart bundled outside reactjit, or
// an older host) every call silently no-ops.
//
// Importance is auto-derived from the event_type substring. Override
// with bus.emit(type, payload, { importance: 0.9 }) only when the
// auto-rule is wrong (e.g. an "ipc.recv" you want flagged because the
// payload is suspiciously large).

import { callHost, callHostJson } from './ffi';

function callHostString(name: string, ...args: unknown[]): string | null {
  const r = callHost<unknown>(name, null, ...args);
  return typeof r === 'string' ? r : null;
}

function callHostNumber(name: string, ...args: unknown[]): number {
  const r = callHost<unknown>(name, 0, ...args);
  return typeof r === 'number' ? r : 0;
}

function payloadToJson(payload: unknown): string {
  if (payload === undefined || payload === null) return '{}';
  if (typeof payload === 'string') return JSON.stringify({ msg: payload });
  try { return JSON.stringify(payload); } catch { return '{}'; }
}

export interface EmitOptions {
  /** Override the auto-importance rule. 0..1, higher = more notable. */
  importance?: number;
  /** Causal-chain parent event id (returned from a prior emit). */
  parentId?: number;
  /** Source label — defaults to "cart" for cart code. */
  source?: string;
}

export interface BusEvent {
  id: number;
  ts: number;
  type: string;
  src: string;
  imp: number;
  par: number | null;
  payload: any;
}

/**
 * Emit an event. Returns the assigned event id (for parentId chaining)
 * or 0 if the bus is unavailable.
 */
export function emit(
  type: string,
  payload?: unknown,
  opts?: EmitOptions,
): number {
  const source = opts?.source ?? 'cart';
  const json = payloadToJson(payload);
  if (opts?.parentId && opts.parentId > 0) {
    return callHostNumber('__busEmitChild', type, source, opts.parentId, json);
  }
  if (typeof opts?.importance === 'number') {
    return callHostNumber(
      '__busEmitWithImportance',
      type, source, opts.importance, json,
    );
  }
  return callHostNumber('__busEmit', type, source, json);
}

/**
 * Fetch the most recent events from the in-memory ring (newest first).
 * Filters by minimum importance. Capped at maxCount.
 *
 * The ring is bounded — events older than ~4096 entries are gone from
 * memory but remain in the on-disk NDJSON log at
 * ~/.cache/reactjit/events-<sessionId>.ndjson.
 */
export function recent(maxCount = 200, minImportance = 0): BusEvent[] {
  return callHostJson<BusEvent[]>('__busRecent', [], maxCount, minImportance);
}

/**
 * Current bus session id. Stable for the process; rolls on every boot.
 * Used by the eventlog cart to title its view; carts can also fold it
 * into payloads if they want cross-session correlation.
 */
export function sessionId(): string {
  return callHostString('__busSessionId') ?? '';
}

/**
 * Absolute path to the SQLite events database. Stable across sessions
 * (currently `~/.cache/reactjit/events.db`). The eventlog cart uses
 * this to open the same db the live runtime is writing to.
 *
 * Returns "" if the bus is in ring-only mode (no SQLite linked).
 */
export function dbPath(): string {
  return callHostString('__busDbPath') ?? '';
}

/**
 * Convenience wrapper for begin/end pairs (e.g. timing a cart phase).
 * Returns a function that emits the corresponding "*.end" event with
 * elapsed_ms in the payload and parent_id linked.
 *
 *   const end = bus.span('boot.first_paint', { cart: 'font_lab' });
 *   ... // do work
 *   end({ nodes: 412 }); // emits boot.first_paint.end
 */
export function span(type: string, payload?: unknown, opts?: EmitOptions): (extra?: object) => number {
  const start = Date.now();
  const startId = emit(`${type}.start`, payload, opts);
  return (extra) => emit(`${type}.end`, { ...(extra ?? {}), elapsed_ms: Date.now() - start }, {
    ...(opts ?? {}),
    parentId: startId || opts?.parentId,
  });
}

export const bus = { emit, recent, sessionId, dbPath, span };
export default bus;
