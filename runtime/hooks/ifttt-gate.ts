// ifttt-gate — stateful "after-X-then-Y-unless-Z" gate primitive.
//
// Models the verify-gate shape that comes up everywhere in the
// pathology / verify-loop catalog:
//
//   after  = the event that opens a verification window
//            (e.g. an Edit on file F)
//   suspect = the candidate claim that should be challenged when no
//            verification has happened in between
//            (e.g. text "fixed" / "shipped")
//   requires = the evidence event that closes the window without
//            firing
//            (e.g. a Bash run / test event that covers F)
//
// Behavior:
//
//   after ─────► suspect ─────► FIRE (no requires in between)
//   after ──► requires ──► suspect ─────► don't fire (gate closed)
//   suspect (no prior after) ─────────► don't fire (window not open)
//
// Optional `key(payload)` extractor lets per-file / per-pid / per-id
// state coexist: openings and closings share a key namespace so an
// Edit on a.zig and an Edit on b.zig open separate windows.
//
// Why programmatic instead of a DSL string source: the three channels
// typically need filter functions richer than a single regex (e.g.
// "tool_use blocks whose .name === 'Edit'"), and the key extractor
// usually inspects payload structure. A spec-string DSL would push the
// complexity into escaping. Callers can still drive this declaratively
// from data — the binder for the Pathology dictionary, for instance,
// can call `registerGate` once per row.

import { subscribe } from '../ffi';

export interface GateOptions<A = any, S = any, R = any> {
  /** Bus channel that opens the verification window. */
  after: string;
  afterFilter?: (payload: A) => boolean;

  /** Bus channel whose payloads are candidate claims. */
  suspect: string;
  suspectFilter?: (payload: S) => boolean;

  /** Bus channel whose payloads close the window without firing. */
  requires: string;
  requiresFilter?: (payload: R) => boolean;

  /** Per-key state extractor. When provided, openings/closings/fires
   *  are scoped per key (e.g. per file path). Omit for a single
   *  shared window. */
  key?: (payload: A | S | R) => string | undefined;

  /** Called when the gate fires. */
  onFire: (info: GateFireInfo<A, S>) => void;

  /** When true, the window stays open after firing — useful when
   *  multiple suspect emits should each fire as long as no requires
   *  arrives. Default false (one fire per after, then gate disarms). */
  reArmOnFire?: boolean;
}

export interface GateFireInfo<A = any, S = any> {
  suspectPayload: S;
  afterPayload: A;
  key?: string;
  firedAt: number;
}

const KEY_SHARED = '__shared__';

/** Register a stateful gate. Returns an unsubscribe that tears down
 *  all three subscriptions and clears state. */
export function registerGate<A = any, S = any, R = any>(opts: GateOptions<A, S, R>): () => void {
  const openings = new Map<string, A>();

  const keyOf = (payload: any): string => {
    if (!opts.key) return KEY_SHARED;
    const x = opts.key(payload);
    return x ?? KEY_SHARED;
  };

  const offAfter = subscribe(opts.after, (payload: any) => {
    if (opts.afterFilter && !opts.afterFilter(payload as A)) return;
    openings.set(keyOf(payload), payload as A);
  });

  const offRequires = subscribe(opts.requires, (payload: any) => {
    if (opts.requiresFilter && !opts.requiresFilter(payload as R)) return;
    openings.delete(keyOf(payload));
  });

  const offSuspect = subscribe(opts.suspect, (payload: any) => {
    if (opts.suspectFilter && !opts.suspectFilter(payload as S)) return;
    const key = keyOf(payload);
    const afterPayload = openings.get(key);
    if (afterPayload === undefined) return;
    if (!opts.reArmOnFire) openings.delete(key);
    try {
      opts.onFire({
        suspectPayload: payload as S,
        afterPayload,
        key: opts.key ? key : undefined,
        firedAt: Date.now(),
      });
    } catch (e: any) {
      console.error('[ifttt-gate] onFire error:', e?.message || e);
    }
  });

  return () => {
    offAfter(); offRequires(); offSuspect();
    openings.clear();
  };
}
