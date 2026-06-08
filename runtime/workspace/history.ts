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

export type HistorySnapshot<T> = {
  undo: T[];
  redo: T[];
  lastCoalesceAt: number;
};

export interface HistoryControls<T> {
  commit: (current: T | null) => void;
  commitCoalesced: (current: T | null) => void;
  undo: (current: T | null) => T | null;
  redo: (current: T | null) => T | null;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

export type HistoryModelOpts<T> = {
  cap?: number;
  coalesceMs?: number;
  now?: () => number;
  initial?: HistorySnapshot<T> | null;
  onChange?: (snapshot: HistorySnapshot<T>) => void;
};

export type HistoryModel<T> = {
  commit: (current: T | null) => void;
  commitCoalesced: (current: T | null) => void;
  undo: (current: T | null) => T | null;
  redo: (current: T | null) => T | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  snapshot: () => HistorySnapshot<T>;
};

export function createHistoryModel<T>(opts: HistoryModelOpts<T> = {}): HistoryModel<T> {
  const cap = opts.cap ?? HISTORY_CAP;
  const coalesceMs = opts.coalesceMs ?? COALESCE_MS;
  const now = opts.now ?? (() => Date.now());
  let undoStack = opts.initial?.undo?.slice() ?? [];
  let redoStack = opts.initial?.redo?.slice() ?? [];
  let lastCoalesceAt = opts.initial?.lastCoalesceAt ?? 0;

  const snapshot = (): HistorySnapshot<T> => ({
    undo: undoStack.slice(),
    redo: redoStack.slice(),
    lastCoalesceAt,
  });

  const changed = (): void => {
    opts.onChange?.(snapshot());
  };

  const push = (stack: T[], value: T): void => {
    stack.push(value);
    if (stack.length > cap) stack.shift();
  };

  return {
    commit: (current: T | null) => {
      if (current === null) return;
      lastCoalesceAt = 0;
      push(undoStack, current);
      redoStack = [];
      changed();
    },

    commitCoalesced: (current: T | null) => {
      if (current === null) return;
      const t = now();
      if (t - lastCoalesceAt < coalesceMs) return;
      lastCoalesceAt = t;
      push(undoStack, current);
      redoStack = [];
      changed();
    },

    undo: (current: T | null): T | null => {
      const prev = undoStack.pop();
      if (prev === undefined) return null;
      if (current !== null) {
        push(redoStack, current);
      }
      changed();
      return prev;
    },

    redo: (current: T | null): T | null => {
      const next = redoStack.pop();
      if (next === undefined) return null;
      if (current !== null) {
        push(undoStack, current);
      }
      changed();
      return next;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear: () => {
      undoStack = [];
      redoStack = [];
      lastCoalesceAt = 0;
      changed();
    },
    snapshot,
  };
}

function readHotHistory<T>(persistKey: string | null): HistorySnapshot<T> | null {
  if (!persistKey) return null;
  try {
    const raw = (globalThis as any).__hot_get?.(persistKey);
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.undo) || !Array.isArray(parsed.redo)) return null;
    return {
      undo: parsed.undo,
      redo: parsed.redo,
      lastCoalesceAt: typeof parsed.lastCoalesceAt === 'number' ? parsed.lastCoalesceAt : 0,
    };
  } catch {
    return null;
  }
}

function writeHotHistory<T>(persistKey: string | null, snapshot: HistorySnapshot<T>): void {
  if (!persistKey) return;
  try {
    (globalThis as any).__hot_set?.(persistKey, JSON.stringify(snapshot));
  } catch {
    // Hot state is best-effort; disk/session persistence still owns durability.
  }
}

export function useHistory<T>(persistKey: string | null = null): HistoryControls<T> {
  const model = useRef<HistoryModel<T> | null>(null);
  if (!model.current) {
    model.current = createHistoryModel<T>({
      initial: readHotHistory<T>(persistKey),
      onChange: (snap) => writeHotHistory(persistKey, snap),
    });
  }
  const [canUndo, setCanUndo] = useState(model.current.canUndo());
  const [canRedo, setCanRedo] = useState(model.current.canRedo());

  const recompute = () => {
    setCanUndo(model.current!.canUndo());
    setCanRedo(model.current!.canRedo());
  };

  const commit = useCallback((current: T | null) => {
    model.current!.commit(current);
    recompute();
  }, []);

  const commitCoalesced = useCallback((current: T | null) => {
    model.current!.commitCoalesced(current);
    recompute();
  }, []);

  const undo = useCallback((current: T | null): T | null => {
    const prev = model.current!.undo(current);
    recompute();
    return prev;
  }, []);

  const redo = useCallback((current: T | null): T | null => {
    const next = model.current!.redo(current);
    recompute();
    return next;
  }, []);

  const clear = useCallback(() => {
    model.current!.clear();
    recompute();
  }, []);

  return { commit, commitCoalesced, undo, redo, canUndo, canRedo, clear };
}
