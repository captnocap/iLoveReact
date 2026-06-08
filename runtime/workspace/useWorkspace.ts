// useWorkspace.ts — the workspace-cart hook.
//
// Wraps the stateless-cart-over-disk pattern that cart/cutout/ proved
// out, generalized for any iterative workspace cart (composer, editor,
// sketchpad, etc.). The cart owns its React state and supplies two
// callbacks:
//
//   buildPayload()      → capture current state into the envelope payload.
//                          Return null when the cart isn't ready to save
//                          (e.g., no source loaded yet).
//   applyPayload(env)   → push a restored envelope back into the cart.
//                          Called on mount-time restore, undo, and redo.
//
// In return, the cart gets autosave (debounced 600ms after the last
// change in `deps`), restore-on-mount (strict-mode safe), undo/redo
// (full-envelope snapshots so a stem rename undoes correctly), and the
// standard ctrl+z / ctrl+y / ctrl+shift+z keyboard bindings.
//
// What the cart MUST handle itself:
//   - Its own React state and handlers.
//   - Cart-specific keyboard shortcuts (ctrl+c/v/x for clipboard,
//     ctrl+s for compile/apply, etc.). Workspace only binds undo/redo.
//   - Calling commit() before a mutation that should be undoable.
//     The mount-time autosave + history work without explicit commits,
//     but discrete edits (stroke start, beat insert, layer mutation)
//     should still snapshot via commit() so undo lands on the right
//     boundary.
//
// See cart/cutout/ for the reference consumer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { readFile, writeFile, mkdir } from '../hooks/fs';
import { useIFTTT } from '../hooks/useIFTTT';
import {
  buildEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type SessionEnvelope,
} from './envelope';
import {
  sessionsDirFor,
  sessionPathFor,
  lastPointerPath,
} from './paths';
import { useHistory, type HistoryControls } from './history';

const AUTOSAVE_DEBOUNCE_MS = 600;

export function workspaceHotCurrentKey(cartName: string, version: number): string {
  return `workspace:${cartName}:v${version}:current`;
}

export function workspaceHotHistoryKey(cartName: string, version: number): string {
  return `workspace:${cartName}:v${version}:history`;
}

function readHotEnvelope<T>(cartName: string, version: number): SessionEnvelope<T> | null {
  try {
    const raw = (globalThis as any).__hot_get?.(workspaceHotCurrentKey(cartName, version));
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return parseEnvelope<T>(raw, { cartName, version });
  } catch {
    return null;
  }
}

function writeHotEnvelope<T>(cartName: string, version: number, env: SessionEnvelope<T> | null): void {
  if (!env) return;
  try {
    (globalThis as any).__hot_set?.(workspaceHotCurrentKey(cartName, version), serializeEnvelope(env));
  } catch {
    // Hot state is best-effort. Disk autosave remains the durable path.
  }
}

export interface WorkspaceArgs<T> {
  /** Cart directory name under `cart/`. Also the kind tag in the
   *  envelope as `<cartName>-session`. */
  cartName: string;
  /** Payload schema revision. Bump when the payload shape changes
   *  incompatibly so older session files cleanly fail to parse. */
  version: number;
  /** Capture the current cart state into a payload. Return null when
   *  the cart has nothing meaningful to save (no source ingested, etc.)
   *  — autosave will skip the flush. */
  buildPayload: () => T | null;
  /** Apply a restored envelope back into the cart. Called from:
   *   - mount-time restore (envelope read from disk)
   *   - undo (previous envelope popped from history)
   *   - redo (next envelope popped from history)
   *  The cart should rehydrate every field from `env.payload`. The
   *  workspace handles stem separately (it owns stem state and will
   *  setStem(env.stem) around this call). */
  applyPayload: (env: SessionEnvelope<T>, reason?: 'restore' | 'history') => void;
  /** State slices that should trigger autosave when they change. Same
   *  list you'd pass to a useEffect deps array. `stem` is implicitly
   *  included; don't list it here. */
  deps: ReadonlyArray<unknown>;
  /** Default stem when nothing has been restored on mount. */
  initialStem?: string;
}

export interface WorkspaceControls<T> {
  stem: string;
  setStem: (s: string) => void;
  /** Snapshot current state onto the undo stack. Call BEFORE a mutation
   *  that should be undoable (stroke start, layer mutation, etc.). */
  commit: () => void;
  /** First-write-wins commit inside a 250ms window. Use for slider /
   *  drag handlers — only the FIRST call in a burst lands on the stack,
   *  so undo returns to "value before the drag started". */
  commitCoalesced: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Timestamp of the last successful autosave flush. */
  lastSavedAt: number | null;
  /** Stem of the session rehydrated on mount, or null if the cart
   *  booted clean. Informational — show it in a status bar so the user
   *  knows their work was restored. */
  restoredFrom: string | null;
  /** Raw history controls. Exposed so the cart can clear() the stack on
   *  events like "ingested a new source" where carrying undo across
   *  documents would be confusing. */
  history: HistoryControls<SessionEnvelope<T>>;
}

export function useWorkspace<T>(args: WorkspaceArgs<T>): WorkspaceControls<T> {
  const { cartName, version, buildPayload, applyPayload, deps, initialStem = 'untitled' } = args;

  const [stem, setStem] = useState<string>(initialStem);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);

  // Mirror stem to a ref so the async autosave flush always reads the
  // latest value, even if the cart renames mid-flush window.
  const stemRef = useRef(stem);
  stemRef.current = stem;

  // Strict-mode guard. React invokes effects twice in dev; without this
  // the second pass clobbers any in-flight edits with the freshly-
  // restored snapshot.
  const restoreOnceRef = useRef(false);

  // Suppress the autosave effect during the restore window — otherwise
  // applying the restored payload's state setters would immediately
  // re-flush the same payload back to disk (no-op write, pointless
  // churn). Cleared on the next tick after restore lands.
  const autosaveSuppressedRef = useRef(true);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const history = useHistory<SessionEnvelope<T>>(workspaceHotHistoryKey(cartName, version));

  // Build an envelope from current state. Used at autosave flush and at
  // every history commit/undo/redo. Returns null when the cart isn't
  // ready (buildPayload returned null).
  const snapshot = useCallback((): SessionEnvelope<T> | null => {
    const payload = buildPayload();
    if (payload === null) return null;
    return buildEnvelope({
      cartName,
      version,
      stem: stemRef.current,
      payload,
    });
  }, [buildPayload, cartName, version]);

  // ── Restore on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (restoreOnceRef.current) return;
    restoreOnceRef.current = true;

    const release = () => {
      // Release suppression on the next tick so the setters inside
      // applyPayload (or the no-op clean-boot path) don't immediately
      // flush back to disk.
      setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
    };

    const hot = readHotEnvelope<T>(cartName, version);
    if (hot) {
      setStem(hot.stem);
      applyPayload(hot, 'restore');
      setRestoredFrom(hot.stem);
      release();
      return;
    }

    const pointer = readFile(lastPointerPath(cartName));
    if (!pointer) { release(); return; }
    const targetStem = pointer.trim();
    if (!targetStem) { release(); return; }
    const text = readFile(sessionPathFor(cartName, targetStem));
    if (!text) { release(); return; }
    const env = parseEnvelope<T>(text, { cartName, version });
    if (!env) { release(); return; }

    setStem(env.stem);
    applyPayload(env, 'restore');
    setRestoredFrom(env.stem);
    release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Debounced autosave ─────────────────────────────────────────────
  // Schedules a flush 600ms after the last change to `[stem, ...deps]`.
  // Repeated changes within the window keep pushing the timer back, so
  // a burst of edits only writes once after the user pauses.
  useEffect(() => {
    if (autosaveSuppressedRef.current) return;
    writeHotEnvelope(cartName, version, snapshot());
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      const env = snapshot();
      if (!env) return;
      mkdir(sessionsDirFor(cartName));
      const ok = writeFile(sessionPathFor(cartName, env.stem), serializeEnvelope(env));
      if (ok) {
        writeFile(lastPointerPath(cartName), env.stem);
        setLastSavedAt(Date.now());
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stem, ...deps]);

  // ── History wrappers ───────────────────────────────────────────────
  // Snapshots are full envelopes (not raw payloads) so an undo across a
  // stem rename restores the prior name. The savedAt field will be stale
  // by the time undo applies it — that's fine, it's a snapshot.
  const commit = useCallback(() => {
    history.commit(snapshot());
  }, [history, snapshot]);

  const commitCoalesced = useCallback(() => {
    history.commitCoalesced(snapshot());
  }, [history, snapshot]);

  const undo = useCallback(() => {
    const prev = history.undo(snapshot());
    if (!prev) return;
    autosaveSuppressedRef.current = true;
    setStem(prev.stem);
    applyPayload(prev, 'history');
    setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
  }, [history, snapshot, applyPayload]);

  const redo = useCallback(() => {
    const next = history.redo(snapshot());
    if (!next) return;
    autosaveSuppressedRef.current = true;
    setStem(next.stem);
    applyPayload(next, 'history');
    setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
  }, [history, snapshot, applyPayload]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────
  // Only undo/redo are bound globally. Cart-specific shortcuts (ctrl+s,
  // ctrl+c/v/x for clipboard, etc.) are the cart's responsibility — they
  // mean different things to different carts.
  useIFTTT('key:ctrl+z', undo);
  useIFTTT('key:ctrl+y', redo);
  useIFTTT('key:ctrl+shift+z', redo);

  return {
    stem,
    setStem,
    commit,
    commitCoalesced,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    lastSavedAt,
    restoredFrom,
    history,
  };
}
