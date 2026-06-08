// editors/paint/history.ts — before-action snapshot undo/redo, headless and
// generic over the snapshot type. The painter uses it with PaintDocument;
// any editor can reuse it for tool-local undo (the route-scoped session
// history in editors/sessions.ts stays the CROSS-session undo chain — this
// is the within-tool, between-commits stack that makes a painter feel like
// a painter).
//
// Model (the cutout history, generalized off React):
//   commit(build)          → push the CURRENT state, clear redo. Call BEFORE
//                            the mutation lands.
//   commitSnapshot(current)→ push an already-captured CURRENT state, clear
//                            redo. Use when the interaction records at
//                            completion time but must restore pre-action
//                            state, e.g. a finished stroke.
//   commitCoalesced(build) → first-write-wins inside a coalesce window, for
//                            slider-style bursts — undo returns to "the value
//                            before the drag started".
//   undo(build) / redo(build) → push current to the other stack, pop+return.
//
// Builders are THUNKS so expensive snapshots (GPU mask readback) only run
// when the commit actually lands — a 60 Hz drag must not do 60 readbacks.
//
// Behavior reference: cart/cutout/history.ts (read, never imported).

import { PAINT_TUNING } from './tuning';

export type SnapshotBuilder<T> = () => T | null;

export type PaintHistory<T> = {
  commit: (build: SnapshotBuilder<T>) => void;
  commitSnapshot: (current: T | null) => void;
  commitCoalesced: (build: SnapshotBuilder<T>) => void;
  undo: (build: SnapshotBuilder<T>) => T | null;
  redo: (build: SnapshotBuilder<T>) => T | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** wipe both stacks (new document — carrying history across would confuse) */
  clear: () => void;
};

export type PaintHistoryOpts = {
  cap?: number;
  coalesceMs?: number;
  /** injectable clock so tests drive the coalesce window deterministically */
  now?: () => number;
};

export function createPaintHistory<T>(opts: PaintHistoryOpts = {}): PaintHistory<T> {
  const cap = opts.cap ?? PAINT_TUNING.history.cap;
  const coalesceMs = opts.coalesceMs ?? PAINT_TUNING.history.coalesceMs;
  const now = opts.now ?? (() => Date.now());
  let undoStack: T[] = [];
  let redoStack: T[] = [];
  let lastCoalesceAt = 0;

  const push = (stack: T[], value: T): void => {
    stack.push(value);
    if (stack.length > cap) stack.shift();
  };

  const commitValue = (current: T | null): void => {
    if (current === null) return;
    lastCoalesceAt = 0; // any explicit commit ends a coalesce window
    push(undoStack, current);
    redoStack = [];
  };

  return {
    commit: (build) => {
      commitValue(build());
    },
    commitSnapshot: commitValue,
    commitCoalesced: (build) => {
      // Throttle BEFORE building — laziness is the whole point.
      const t = now();
      if (t - lastCoalesceAt < coalesceMs) return; // already snapped this burst
      const current = build();
      if (current === null) return;
      lastCoalesceAt = t;
      push(undoStack, current);
      redoStack = [];
    },
    undo: (build) => {
      const prev = undoStack.pop();
      if (prev === undefined) return null;
      const current = build();
      if (current !== null) push(redoStack, current);
      return prev;
    },
    redo: (build) => {
      const next = redoStack.pop();
      if (next === undefined) return null;
      const current = build();
      if (current !== null) push(undoStack, current);
      return next;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear: () => {
      undoStack = [];
      redoStack = [];
      lastCoalesceAt = 0;
    },
  };
}
