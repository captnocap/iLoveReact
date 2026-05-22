// history.ts — undo/redo for the cutout cart.
//
// The cart already produces a SessionDocument snapshot on every meaningful
// state change (for autosave). Undo / redo are a thin wrapper on top of
// that: push the SnapshotBeforeOperation, then undo pops back to it.
//
// Model is "before-action snapshot":
//   commit(current) → push `current` onto undo, clear redo. Called by
//                      state.ts handlers BEFORE the mutation lands.
//   undo(current)   → push `current` onto redo, pop+return undo top.
//   redo(current)   → push `current` onto undo, pop+return redo top.
//
// A coalesce window is provided for slider-style continuous edits: the
// FIRST call within a 250 ms burst commits, subsequent calls are
// ignored. The undo state reflects "value before the drag started",
// which matches user intuition.

import { useCallback, useRef, useState } from 'react';
import type { SessionDocument } from './session';

const HISTORY_CAP = 50;
const COALESCE_MS = 250;

/** Callers pass a THUNK rather than a pre-built SessionDocument so
 *  expensive parts of building the snapshot (GPU mask readback) only
 *  run when the commit is actually going to land. A slider drag fires
 *  commitCoalesced dozens of times per second; the 250ms throttle
 *  drops all but the first, but if the snapshot is built eagerly at
 *  every call the throttle saves no work. */
export type SnapshotBuilder = () => SessionDocument | null;

export interface HistoryControls {
  /** Push the current snapshot. Called before a mutation. Clears redo. */
  commit: (build: SnapshotBuilder) => void;
  /** First-write-wins commit inside a 250 ms window. Drag handlers call
   *  this on every value change; only the FIRST call in a burst lands
   *  on the stack. The previously-committed value is what undo returns
   *  to — i.e. "the value before the drag started". */
  commitCoalesced: (build: SnapshotBuilder) => void;
  /** Pop undo into `current` going to redo. Returns the snapshot to
   *  apply, or null if the stack was empty. */
  undo: (build: SnapshotBuilder) => SessionDocument | null;
  redo: (build: SnapshotBuilder) => SessionDocument | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Wipe both stacks. Called when the cart ingests a new image —
   *  carrying undo history across documents would be confusing. */
  clear: () => void;
}

export function useHistory(): HistoryControls {
  const undoStack = useRef<SessionDocument[]>([]);
  const redoStack = useRef<SessionDocument[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastCoalesceAt = useRef(0);

  const recompute = () => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  };

  const commit = useCallback((build: SnapshotBuilder) => {
    // Build the snapshot only once we know we're going to commit. For
    // commit() that's always (no throttle); the laziness mostly matters
    // for commitCoalesced below, but keeping the API symmetric stops
    // call sites from accidentally re-building eagerly elsewhere.
    const current = build();
    if (!current) return;
    lastCoalesceAt.current = 0; // any explicit commit ends a coalesce window
    undoStack.current.push(current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    redoStack.current = [];
    recompute();
  }, []);

  const commitCoalesced = useCallback((build: SnapshotBuilder) => {
    // Throttle BEFORE building — a slider drag at 60 Hz would otherwise
    // do 60 GPU readbacks per second to populate the snapshot's mask
    // payload, even though the throttle drops all but the first.
    const now = Date.now();
    if (now - lastCoalesceAt.current < COALESCE_MS) return; // already snapped this burst
    const current = build();
    if (!current) return;
    lastCoalesceAt.current = now;
    undoStack.current.push(current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    redoStack.current = [];
    recompute();
  }, []);

  const undo = useCallback((build: SnapshotBuilder): SessionDocument | null => {
    const prev = undoStack.current.pop();
    if (!prev) return null;
    const current = build();
    if (current) {
      redoStack.current.push(current);
      if (redoStack.current.length > HISTORY_CAP) redoStack.current.shift();
    }
    recompute();
    return prev;
  }, []);

  const redo = useCallback((build: SnapshotBuilder): SessionDocument | null => {
    const next = redoStack.current.pop();
    if (!next) return null;
    const current = build();
    if (current) {
      undoStack.current.push(current);
      if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    }
    recompute();
    return next;
  }, []);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    lastCoalesceAt.current = 0;
    recompute();
  }, []);

  return { commit, commitCoalesced, undo, redo, canUndo, canRedo, clear };
}
