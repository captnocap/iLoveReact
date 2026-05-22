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

export interface HistoryControls {
  /** Push the current snapshot. Called before a mutation. Clears redo. */
  commit: (current: SessionDocument | null) => void;
  /** First-write-wins commit inside a 250 ms window. Drag handlers call
   *  this on every value change; only the FIRST call in a burst lands
   *  on the stack. The previously-committed value is what undo returns
   *  to — i.e. "the value before the drag started". */
  commitCoalesced: (current: SessionDocument | null) => void;
  /** Pop undo into `current` going to redo. Returns the snapshot to
   *  apply, or null if the stack was empty. */
  undo: (current: SessionDocument | null) => SessionDocument | null;
  redo: (current: SessionDocument | null) => SessionDocument | null;
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

  const commit = useCallback((current: SessionDocument | null) => {
    if (!current) return;
    lastCoalesceAt.current = 0; // any explicit commit ends a coalesce window
    undoStack.current.push(current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    redoStack.current = [];
    recompute();
  }, []);

  const commitCoalesced = useCallback((current: SessionDocument | null) => {
    if (!current) return;
    const now = Date.now();
    if (now - lastCoalesceAt.current < COALESCE_MS) return; // already snapped this burst
    lastCoalesceAt.current = now;
    undoStack.current.push(current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    redoStack.current = [];
    recompute();
  }, []);

  const undo = useCallback((current: SessionDocument | null): SessionDocument | null => {
    const prev = undoStack.current.pop();
    if (!prev) return null;
    if (current) {
      redoStack.current.push(current);
      if (redoStack.current.length > HISTORY_CAP) redoStack.current.shift();
    }
    recompute();
    return prev;
  }, []);

  const redo = useCallback((current: SessionDocument | null): SessionDocument | null => {
    const next = redoStack.current.pop();
    if (!next) return null;
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
