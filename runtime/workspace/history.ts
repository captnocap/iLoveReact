// history.ts — generic undo/redo for workspace carts.
//
// Model is "before-action snapshot":
//   commit(current)         → push `current` onto undo, clear redo. Call
//                              BEFORE a mutation lands.
//   commitCoalesced(current)→ first call within a 250ms window commits;
//                              subsequent calls are ignored. For
//                              slider/drag-style continuous edits — undo
//                              returns "value before the drag started",
//                              which matches user intuition.
//   undo(current)           → push `current` onto redo, pop+return undo top.
//   redo(current)           → push `current` onto undo, pop+return redo top.
//
// Generic over the snapshot type T. Workspace carts pass
// SessionEnvelope<TheirPayload>; the snapshot mechanism doesn't care
// what's in it.

import { useCallback, useRef, useState } from 'react';

const HISTORY_CAP = 50;
const COALESCE_MS = 250;

export interface HistoryControls<T> {
  commit: (current: T | null) => void;
  commitCoalesced: (current: T | null) => void;
  undo: (current: T | null) => T | null;
  redo: (current: T | null) => T | null;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

export function useHistory<T>(): HistoryControls<T> {
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastCoalesceAt = useRef(0);

  const recompute = () => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  };

  const commit = useCallback((current: T | null) => {
    if (!current) return;
    lastCoalesceAt.current = 0;
    undoStack.current.push(current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    redoStack.current = [];
    recompute();
  }, []);

  const commitCoalesced = useCallback((current: T | null) => {
    if (!current) return;
    const now = Date.now();
    if (now - lastCoalesceAt.current < COALESCE_MS) return;
    lastCoalesceAt.current = now;
    undoStack.current.push(current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    redoStack.current = [];
    recompute();
  }, []);

  const undo = useCallback((current: T | null): T | null => {
    const prev = undoStack.current.pop();
    if (!prev) return null;
    if (current) {
      redoStack.current.push(current);
      if (redoStack.current.length > HISTORY_CAP) redoStack.current.shift();
    }
    recompute();
    return prev;
  }, []);

  const redo = useCallback((current: T | null): T | null => {
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
