/**
 * useLocalStore — keyed persistent state, JSON-serialized into the
 * SQLite-backed framework/localstore.zig.
 *
 * Behaves like useState, but values survive process restarts:
 *
 *   const [theme, setTheme] = useLocalStore('app', 'theme', 'dark');
 *   setTheme('light'); // also persists
 *
 * Values are JSON-encoded; restrict to JSON-safe types.
 *
 * Namespacing keeps keys from colliding across features. Common pattern:
 * one namespace per cart-area (e.g. 'editor', 'sidebar', 'prefs').
 *
 * Reads happen synchronously on first render. Writes go through localstore
 * 's write-behind queue — fast to call, durable on the next flush.
 */

import { useState, useCallback } from 'react';
import { callHost } from '../ffi';

type Updater<T> = T | ((prev: T) => T);

export function useLocalStore<T>(
  namespace: string,
  key: string,
  initial: T,
): [T, (next: Updater<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    const has = callHost<number>('__localstoreHas', 0, namespace, key);
    if (has === 1) {
      const raw = callHost<string>('__localstoreGet', '', namespace, key);
      try { return JSON.parse(raw) as T; } catch { /* corrupt — fall through */ }
    }
    // Seed the store so a process restart sees the chosen initial even
    // if the user never explicitly setValue's.
    callHost('__localstoreSet', undefined, namespace, key, JSON.stringify(initial));
    return initial;
  });

  const update = useCallback(
    (next: Updater<T>): void => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        callHost('__localstoreSet', undefined, namespace, key, JSON.stringify(resolved));
        return resolved;
      });
    },
    [namespace, key],
  );

  return [value, update];
}

/** One-shot remove for a key. */
export function deleteLocalStoreKey(namespace: string, key: string): void {
  callHost('__localstoreDelete', undefined, namespace, key);
}

/** Clear an entire namespace; pass `''` to wipe all namespaces. */
export function clearLocalStore(namespace: string = ''): void {
  callHost('__localstoreClear', undefined, namespace);
}
