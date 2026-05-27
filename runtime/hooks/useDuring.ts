/**
 * useDuring — run `body` for the lifetime of `x`.
 *
 * Polymorphic temporal primitive. `x` is classified at effect setup and
 * dispatched on shape:
 *
 *   useDuring(undefined,    body)   // ← mount cycle (alias for "until unmount")
 *   useDuring(5_000,        body)   // ← number: open for ms, then close
 *   useDuring(fetchPromise, body)   // ← Promise: open while pending
 *   useDuring(signal,       body)   // ← AbortSignal: open until aborted
 *   useDuring(streamIter,   body)   // ← AsyncIterable: open until done
 *   useDuring(otherHandle,  body)   // ← another useDuring handle: same window
 *   useDuring(() => async,  body)   // ← thunk: called once, return is treated
 *                                   //    as one of the above (Promise → span;
 *                                   //    anything else → instant)
 *
 * `body` receives an `AbortSignal` so async bodies can bail when the window
 * is closed externally (cancel / unmount / signal-arm abort). If body
 * returns a function it runs as cleanup on close; if body returns a Promise
 * resolving to a function, that fn runs as cleanup too — including if the
 * promise resolves AFTER the window already closed (run-immediately,
 * not stashed-and-leaked).
 *
 * ── What changed from v1 ─────────────────────────────────────────
 *
 * - `boolean` is gone. `useDuring(isPaused, body)` was render-polled,
 *   which doesn't match what "during" implies. For boolean conditions,
 *   use `useEffect` with `[isPaused]` in deps — that's the idiomatic
 *   React answer. For polled predicates, build a proper signal or
 *   compose `useDuring(fetch(...), body)` against a real async source.
 *
 * - Polled-thunk-boolean is gone. `() => boolean` no longer triggers
 *   50ms polling. Functions are now treated uniformly: call once, treat
 *   the return value as the new lifetime.
 *
 * - `body` receives a `signal` parameter. Old bodies that ignored the
 *   parameter still work.
 *
 * - `startedAt` uses `performance.now()` (monotonic) instead of
 *   `Date.now()` (wall clock).
 *
 * - The handle is NOT a thenable (despite v1's docstring claim). It has
 *   a `.done` Promise property. To await window-close, `await h.done`.
 *
 * ── Gotcha: stable `x` ────────────────────────────────────────────
 * Every render re-evaluates `useDuring(EXPR, …)`. If EXPR builds a new
 * object/promise each time (`useDuring(fetch('/x'), …)`), the effect
 * would tear down + restart the window each render. Two mitigations:
 *   - thunk form: `useDuring(() => fetch('/x'), …)` (called once per
 *     shape change inside the hook, NOT once per render — see "Shape
 *     keying" below).
 *   - stable ref: `const p = useMemo(() => fetch('/x'), [k]); useDuring(p, …)`.
 *
 * ── Shape keying ──────────────────────────────────────────────────
 * The dispatch effect's dep is a *shape key*, not the raw `x`. Shape
 * keys are coarse: `'mount'`, `'num:5000'`, an identity key for
 * Promise/Signal/Iterable/handle instances, or `'fn'` for any function.
 * So passing an inline thunk that changes identity every render does NOT
 * restart the window — `xRef.current` is read at dispatch time and
 * stays current.
 *
 * ── Composing ─────────────────────────────────────────────────────
 * `useDuring(outer, body)` borrows another handle's window:
 *
 *   const outer = useDuring(fetchA, () => spinner('A'));
 *   useDuring(outer, () => analytics('a-in-flight'));
 *
 * `outer.done` resolves the moment outer's window closes; body runs
 * for exactly that span.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLatest } from './useLatest';

// ── Public types ──────────────────────────────────────────────────

export type DuringBody =
  | ((signal: AbortSignal) => void | (() => void))
  | ((signal: AbortSignal) => Promise<void | (() => void)>)
  | (() => void | (() => void))
  | (() => Promise<void | (() => void)>);

export type DuringLifetime =
  | undefined
  | number
  | Promise<unknown>
  | AbortSignal
  | AsyncIterable<unknown>
  | UseDuringHandle
  | (() => unknown);

export interface UseDuringHandle {
  /** True while the window is open. Reading this getter opts the host
   *  into rerender on every active-state transition. */
  readonly active: boolean;
  /** `performance.now()` at the time the current window opened. 0 when
   *  not active. */
  readonly startedAt: number;
  /** Force-close the window. The body's AbortSignal fires; any async
   *  body promise still in flight settles invisibly (its return value
   *  is discarded but cleanup fns it produces will still run). */
  cancel(): void;
  /** Always-pending Promise that resolves when the *next* window-close
   *  happens. Atomically swapped to a fresh pending after each close, so
   *  `await h.done` before any window has opened still blocks until the
   *  first close. */
  readonly done: Promise<void>;
}

// ── Shape predicates ──────────────────────────────────────────────

function isPromise(v: unknown): v is Promise<unknown> {
  return !!v && typeof v === 'object' && typeof (v as { then?: unknown }).then === 'function';
}

function isAbortSignal(v: unknown): v is AbortSignal {
  return !!v
    && typeof v === 'object'
    && 'aborted' in v
    && typeof (v as AbortSignal).addEventListener === 'function';
}

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return !!v
    && typeof v === 'object'
    && typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';
}

function isDuringHandle(v: unknown): v is UseDuringHandle {
  return !!v
    && typeof v === 'object'
    && 'done' in v
    && isPromise((v as UseDuringHandle).done)
    && typeof (v as UseDuringHandle).cancel === 'function';
}

// Stable WeakMap-assigned identity key for object inputs, so the effect's
// dep array can ref-equality across renders without serializing.
let _shapeIdCounter = 0;
const _shapeIds = new WeakMap<object, number>();
function shapeKeyForInstance(obj: object): string {
  let id = _shapeIds.get(obj);
  if (id == null) { id = ++_shapeIdCounter; _shapeIds.set(obj, id); }
  return `i:${id}`;
}

function classifyShape(x: DuringLifetime): string {
  if (x === undefined) return 'mount';
  if (typeof x === 'number') return `num:${x}`;
  if (typeof x === 'function') return 'fn';
  if (isDuringHandle(x)) return shapeKeyForInstance(x as unknown as object);
  if (isPromise(x)) return shapeKeyForInstance(x as unknown as object);
  if (isAbortSignal(x)) return shapeKeyForInstance(x as unknown as object);
  if (isAsyncIterable(x)) return shapeKeyForInstance(x as unknown as object);
  return 'unknown';
}

// ── The hook ──────────────────────────────────────────────────────

export function useDuring(x: DuringLifetime, body: DuringBody): UseDuringHandle {
  // Latest x / body via refs so the dispatch effect doesn't have to
  // depend on their identity. For unstable thunks this is the entire
  // point — `xRef.current` stays current across renders without restart.
  const xRef = useLatest(x);
  const bodyRef = useLatest(body);

  // ── Window state (refs + opt-in forceTick) ────────────────────
  //
  // Mirrors IFTTTResult's lazy-reactivity pattern: refs hold truth, a
  // forceTick state is bumped ONLY when a consumer has read .active /
  // .startedAt / .done. Carts that never read the handle stay zero-
  // rerender; conditional reads still flip the sticky flag permanently
  // (matches useIFTTT documented behaviour).
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);
  const subscribedRef = useRef(false);
  const [, forceTick] = useState(0);

  // Generation token. Each open assigns gen++; settle paths check the
  // token matches before mutating. cancel() bumps gen, so stale Promise
  // settlements become no-ops.
  const genRef = useRef(0);

  // Always-pending Promise for `.done`. Eagerly seeded so awaiters
  // captured BEFORE any window opens still block.
  const doneRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (doneRef.current == null) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    doneRef.current = { promise, resolve };
  }

  // Imperative cancel — set by the dispatch effect so handle.cancel()
  // reaches the live window. Recreated each effect.
  const cancelRef = useRef<() => void>(() => {});

  // Track mount so post-unmount setState (well, forceTick) is a no-op.
  // React 18 tolerates the warning but the result is wasted work.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  function bump(): void {
    if (subscribedRef.current && mountedRef.current) {
      forceTick((n) => (n + 1) & 0xffff);
    }
  }

  function rotateDone(): void {
    const prior = doneRef.current!;
    let nextResolve!: () => void;
    doneRef.current = {
      promise: new Promise<void>((r) => { nextResolve = r; }),
      resolve: nextResolve,
    };
    prior.resolve();
  }

  // ── The dispatch effect ──────────────────────────────────────
  //
  // Runs once per shape change. Inside, we set up:
  //   - controller    — owned AbortController; passed to body, aborted on close
  //   - openWindow()  — flip activeRef true, run body, capture cleanup
  //   - closeWindow() — flip activeRef false, abort, run cleanup, rotate done
  //   - cancelRef     — wired so handle.cancel() reaches closeWindow
  //   - the actual lifetime watcher for whatever shape x has
  const shapeKey = useMemo(() => classifyShape(x), [classifyShape, x]);

  useEffect(() => {
    let myGen = 0;
    let opened = false;
    let cleanupFn: (() => void) | null = null;
    let controller: AbortController | null = null;
    // External terminators that we ourselves installed — torn down in
    // the effect cleanup regardless of whether the window is open.
    let detachers: Array<() => void> = [];

    const openWindow = (): void => {
      if (opened) return;
      opened = true;
      genRef.current += 1;
      myGen = genRef.current;
      activeRef.current = true;
      startedAtRef.current = performance.now();
      controller = new AbortController();
      bump();

      let result: unknown;
      try { result = (bodyRef.current as (s: AbortSignal) => unknown)(controller.signal); }
      catch (e: any) {
        console.error('[useDuring] body threw:', e?.message || e);
        return;
      }
      if (isPromise(result)) {
        result.then(
          (c) => {
            if (typeof c !== 'function') return;
            // Race: if the window already closed by the time the body
            // promise resolves, run the cleanup IMMEDIATELY rather than
            // stashing it — stashing leaks because closeWindow already
            // ran without it.
            if (!opened || myGen !== genRef.current) {
              try { (c as () => void)(); } catch (e: any) {
                console.error('[useDuring] late cleanup error:', e?.message || e);
              }
              return;
            }
            cleanupFn = c as () => void;
          },
          (e: any) => console.error('[useDuring] body promise rejected:', e?.message || e),
        );
      } else if (typeof result === 'function') {
        cleanupFn = result as () => void;
      }
    };

    const closeWindow = (): void => {
      if (!opened) return;
      opened = false;
      // Bump gen FIRST so any in-flight body-promise resolutions see a
      // stale myGen and run their cleanup themselves instead of stashing.
      genRef.current += 1;
      activeRef.current = false;
      startedAtRef.current = 0;
      // Abort BEFORE cleanup so the body can react to the signal in its
      // own cleanup if needed.
      if (controller) { try { controller.abort(); } catch { /* ignore */ } controller = null; }
      const c = cleanupFn; cleanupFn = null;
      if (c) {
        try { c(); } catch (e: any) {
          console.error('[useDuring] cleanup error:', e?.message || e);
        }
      }
      rotateDone();
      bump();
    };

    cancelRef.current = () => { closeWindow(); };

    // ── Shape dispatch ────────────────────────────────────────
    //
    // Reads xRef.current (not the closed-over x) so subsequent renders
    // can swap the thunk identity without restarting; the shape key
    // already gates restart granularity.
    const xNow = xRef.current;

    if (xNow === undefined) {
      // Mount window — open immediately, close on cleanup.
      openWindow();
      return () => { closeWindow(); };
    }

    if (typeof xNow === 'number') {
      openWindow();
      const id = setTimeout(() => closeWindow(), xNow);
      detachers.push(() => clearTimeout(id));
      return () => { for (const d of detachers) d(); closeWindow(); };
    }

    if (isDuringHandle(xNow)) {
      openWindow();
      xNow.done.finally(() => closeWindow());
      return () => { closeWindow(); };
    }

    if (isPromise(xNow)) {
      openWindow();
      xNow.finally(() => closeWindow());
      return () => { closeWindow(); };
    }

    if (isAbortSignal(xNow)) {
      if (xNow.aborted) { return () => {}; }
      openWindow();
      const onAbort = () => closeWindow();
      xNow.addEventListener('abort', onAbort);
      detachers.push(() => xNow.removeEventListener('abort', onAbort));
      return () => { for (const d of detachers) d(); closeWindow(); };
    }

    if (isAsyncIterable(xNow)) {
      openWindow();
      // Hold the iterator manually so cleanup can `.return()` it; a
      // `break` inside `for await` only unblocks AFTER the next value
      // arrives, which is exactly what we don't want for long-polls.
      const it = (xNow as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      let aborted = false;
      detachers.push(() => {
        aborted = true;
        try { it.return?.(undefined); } catch { /* ignore */ }
      });
      (async () => {
        try {
          while (!aborted) {
            const step = await it.next();
            if (step.done) break;
          }
        } catch (e: any) {
          if (!aborted) console.error('[useDuring] async iterable error:', e?.message || e);
        }
        if (!aborted) closeWindow();
      })();
      return () => { for (const d of detachers) d(); closeWindow(); };
    }

    if (typeof xNow === 'function') {
      // Call once. Treat the return value uniformly:
      //   Promise   → window spans the pending phase
      //   anything  → instant window (body just executed sync)
      // No more polled-boolean — see "What changed from v1" in the
      // module docstring.
      let result: unknown;
      try { result = (xNow as () => unknown)(); }
      catch (e: any) {
        console.error('[useDuring] thunk threw:', e?.message || e);
        return () => {};
      }
      if (isPromise(result)) {
        openWindow();
        result.finally(() => closeWindow());
        return () => { closeWindow(); };
      }
      // Non-Promise return → caller used `useDuring(() => syncOp(), …)`.
      // Their op already ran; the window is instantaneous. We still open
      // and immediately close so the `done` promise rotates and consumers
      // see a transition.
      openWindow();
      closeWindow();
      return () => {};
    }

    console.warn('[useDuring] unrecognised lifetime shape:', xNow);
    return () => {};
  }, [shapeKey]);

  return useMemo<UseDuringHandle>(() => ({
    get active() {
      subscribedRef.current = true;
      return activeRef.current;
    },
    get startedAt() {
      subscribedRef.current = true;
      return startedAtRef.current;
    },
    get done() {
      subscribedRef.current = true;
      return doneRef.current!.promise;
    },
    cancel: () => cancelRef.current(),
  }), []);
}
