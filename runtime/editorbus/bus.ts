// editorbus/bus.ts — the ordered process-session outcome-stream door.
//
// This file is the CONTRACT for the host side: workstream A implements the
// `__editor_bus_*` doors in Zig (framework/events/). Until it lands, this door
// degrades to an in-process local log so the TS workstreams (commands, defaults,
// build-journal) can build, emit, and unit-test against the real surface now.
//
// dispatch() appends an already-applied outcome and assigns its authoritative
// `seq`; it does not validate a command or apply application state. Migrated
// systems enter through CommandAuthority and only its outcome sink dispatches.
// Legacy callers still dispatch receipts directly until their slice migrates.
// The stream is not document state or cross-process storage: a cold host starts
// empty, while a V8 hot reload retains it because the native host stays alive.

import { callHost, callHostJson, hasHost, subscribe as ffiSubscribe, emit as ffiEmit } from '../ffi';
import { type EditorEvent, type Seq, SEQ_PENDING } from './event';

// The ffi listener channel the host fans confirmed events out on (via __ffiEmit),
// and that the local fallback uses too, so subscribers don't care which is live.
export const EDITOR_BUS_CHANNEL = 'editor.bus';

// ── Host-door contract (workstream A implements these in Zig) ───────────────
declare module '../ffi' {
  interface HostCalls {
    /** Append one event (JSON envelope). Returns the authoritative seq assigned,
     *  or -1 if rejected. The host stamps `seq` and re-broadcasts the confirmed
     *  envelope on EDITOR_BUS_CHANNEL via __ffiEmit. */
    __editor_bus_emit(json: string): number;
    /** JSON array of confirmed events with seq > `afterSeq` (for catch-up/replay). */
    __editor_bus_since(afterSeq: number): string;
    /** Highest authoritative seq currently committed (0 if empty). */
    __editor_bus_head(): number;
  }
}

// ── Local fallback (only used until the Zig door exists) ────────────────────
const _localLog: EditorEvent[] = [];
let _localSeq = 0;

function hostLive(): boolean {
  return hasHost('__editor_bus_emit');
}

function localEmit(e: EditorEvent): Seq {
  const confirmed: EditorEvent = { ...e, seq: ++_localSeq };
  _localLog.push(confirmed);
  // Local-origin events fan out synchronously (the ffi JS-origin convention).
  // The host-backed path instead re-broadcasts confirmed events itself via
  // __ffiEmit (deferred), so subscribers stay transport-agnostic either way.
  ffiEmit(EDITOR_BUS_CHANNEL, confirmed);
  return confirmed.seq;
}

/**
 * Dispatch an authoring event. Returns the authoritative seq (or SEQ_PENDING if
 * the host rejected it). The returned event is also broadcast on
 * EDITOR_BUS_CHANNEL, so a subscriber that applied it optimistically can
 * reconcile by seq.
 */
export function dispatch(e: EditorEvent): Seq {
  if (hostLive()) {
    const seq = callHost<number>('__editor_bus_emit', SEQ_PENDING, JSON.stringify(e));
    return typeof seq === 'number' ? seq : SEQ_PENDING;
  }
  return localEmit(e);
}

/** Subscribe to confirmed events as they commit. Returns an unsubscribe fn.
 *  Listener receives the confirmed envelope (with its real `seq`).
 *
 *  Transport-agnostic by design: the Zig bus fans out the confirmed envelope as a
 *  JSON string (via __ffiEmit), while the local fallback fans out a parsed object.
 *  We normalize string payloads here so subscribers always receive an EditorEvent
 *  regardless of which path is live. */
export function onEvent(fn: (e: EditorEvent) => void): () => void {
  return ffiSubscribe(EDITOR_BUS_CHANNEL, (p: any) => {
    let e = p;
    if (typeof e === 'string') {
      try { e = JSON.parse(e); } catch { return; }
    }
    fn(e as EditorEvent);
  });
}

/** Confirmed events with seq > afterSeq, oldest first — for catch-up / replay. */
export function since(afterSeq = 0): EditorEvent[] {
  if (hostLive()) return callHostJson<EditorEvent[]>('__editor_bus_since', [], afterSeq);
  return _localLog.filter((e) => e.seq > afterSeq);
}

/** Highest committed seq (0 if empty). */
export function head(): Seq {
  if (hostLive()) return callHost<number>('__editor_bus_head', 0);
  return _localSeq;
}

/** True when the authoritative Zig bus is wired (vs the local fallback). */
export function isHostBacked(): boolean {
  return hostLive();
}

export const editorBus = { dispatch, onEvent, since, head, isHostBacked };
export default editorBus;
