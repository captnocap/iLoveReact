/**
 * useHotState — React state that survives dev-mode hot reloads.
 *
 * In dev mode (`./scripts/dev <cart>`), saving a .tsx file tears down the
 * QuickJS context and re-evals a fresh bundle, which normally wipes all
 * React state. Atoms stored via `useHotState` survive because they're
 * persisted in Zig-owned memory (`framework/hotstate.zig`), outside the
 * JS world that gets torn down.
 *
 * Usage:
 *   const [count, setCount] = useHotState('counter', 0);
 *   setCount((c) => c + 1); // survives the next hot reload
 *
 * Key contract:
 *   - Pick a stable, globally-unique string per atom. Keys live for the whole
 *     process — two components with the same key SHARE state.
 *   - Values must be JSON-serializable. Functions, class instances, DOM refs
 *     will lose their identity on reload.
 *
 * Outside dev mode (`./scripts/ship`), the host functions aren't registered
 * (they still work — this file doesn't gate behavior on dev mode — but the
 * persistence is per-process either way). Functionally behaves as useState.
 */

import * as React from 'react';
import { callHost, callHostJson } from '../ffi';

type Updater<T> = T | ((prev: T) => T);

export function useHotState<T>(key: string, initial: T): [T, (v: Updater<T>) => void] {
  const [value, setValue] = React.useState<T>(() => {
    const stored = callHostJson<T | undefined>('__hot_get', undefined, key);
    if (stored !== undefined) return stored;
    // First time seeing this key — seed the store with the initial value so a
    // hot reload before the first setState still recovers it.
    callHost('__hot_set', undefined, key, JSON.stringify(initial));
    return initial;
  });

  const set = React.useCallback((updater: Updater<T>) => {
    setValue((prev: T) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      callHost('__hot_set', undefined, key, JSON.stringify(next));
      return next;
    });
  }, [key]);

  return [value, set];
}

/** Imperative read of a hot atom (non-hook), for module-level stores that need
 *  twig state which survives a hot reload but resets on a cold process restart
 *  (hotstate is in-process). Returns `fallback` when the key is unset. */
export function getHotState<T>(key: string, fallback: T): T {
  const stored = callHostJson<T | undefined>('__hot_get', undefined, key);
  return stored === undefined ? fallback : stored;
}

/** Imperative write of a hot atom (non-hook). Survives hot reload, not restart. */
export function setHotState<T>(key: string, value: T): void {
  callHost('__hot_set', undefined, key, JSON.stringify(value));
}

/** Remove a single atom. Equivalent to "forget this key across reloads." */
export function removeHotState(key: string): void {
  callHost('__hot_remove', undefined, key);
}

/** Wipe every atom. Useful from a dev-tools "reset state" button. */
export function clearHotState(): void {
  callHost('__hot_clear', undefined);
}

/** List all atom keys currently stored. */
export function hotStateKeys(): string[] {
  return callHostJson<string[]>('__hot_keys_json', []);
}
