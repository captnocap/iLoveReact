/**
 * localstore — persistent key/value store backed by framework/localstore.zig.
 *
 * A drop-in replacement for browser `localStorage` for carts that copy-paste
 * React code assuming it exists. The underlying store persists to disk
 * (~/.cache/<app>/store.db by default).
 *
 * Registration (Zig side):
 *
 *   qjs_runtime.registerHostFn("__store_get", @ptrCast(&store_get), 1);
 *   qjs_runtime.registerHostFn("__store_set", @ptrCast(&store_set), 2);
 *   qjs_runtime.registerHostFn("__store_remove", @ptrCast(&store_remove), 1);
 *   qjs_runtime.registerHostFn("__store_clear", @ptrCast(&store_clear), 0);
 *   qjs_runtime.registerHostFn("__store_keys_json", @ptrCast(&store_keys_json), 0);
 */

import { callHost, callHostJson } from '../ffi';

// [store-read] boot transfer meter (req_1751): the editor pulls big blobs out of the
// localstore at boot — hmsc's 'game-state' alone is ~1.2MB of JSON. This counts the
// host→JS read bytes per (namespace,key) so the / route's "I MADE IT" dump shows what
// sqlite handed up before the route went live, beside the JS→host flush total. Reads
// only (writes don't block reaching the route); array key-lists are negligible.
const g_storeReads = new Map<string, { n: number; bytes: number }>();
let g_storeReadTotal = 0;
function meterRead(label: string, bytes: number): void {
  if (bytes <= 0) return;
  g_storeReadTotal += bytes;
  const e = g_storeReads.get(label) ?? { n: 0, bytes: 0 };
  e.n += 1; e.bytes += bytes; g_storeReads.set(label, e);
}
(globalThis as any).__storeReadReport = () => ({
  totalBytes: g_storeReadTotal,
  byKey: [...g_storeReads.entries()].map(([key, e]) => ({ key, n: e.n, bytes: e.bytes })).sort((a, b) => b.bytes - a.bytes),
});
(globalThis as any).__storeReadReset = () => { g_storeReads.clear(); g_storeReadTotal = 0; };

/** Get a value by key. Returns null if missing. */
export function get(key: string): string | null {
  const v = callHost<string | null>('__store_get', null, key);
  meterRead(`app:${key}`, v ? v.length : 0);
  return v;
}

/** Set a key to a string value. */
export function set(key: string, value: string): void {
  callHost<void>('__store_set', undefined as any, key, value);
}

/** Remove a key. No-op if missing. */
export function remove(key: string): void {
  callHost<void>('__store_remove', undefined as any, key);
}

/** Wipe everything. */
export function clear(): void {
  callHost<void>('__store_clear', undefined as any);
}

/** List all keys. */
export function keys(): string[] {
  return callHostJson<string[]>('__store_keys_json', []);
}

// ── V8 namespaced localstore surface ───────────────────────────────

/** Get a value from a namespace + key pair. Returns '' when missing. */
export function nsGet(namespace: string, key: string): string {
  const v = callHost<string>('__localstoreGet', '', namespace, key);
  meterRead(`${namespace}:${key}`, v ? v.length : 0);
  return v;
}

/** Return true when namespace + key exists. */
export function nsHas(namespace: string, key: string): boolean {
  return callHost<number>('__localstoreHas', 0, namespace, key) === 1;
}

/** Set a namespaced value. */
export function nsSet(namespace: string, key: string, value: string): void {
  callHost<void>('__localstoreSet', undefined as any, namespace, key, value);
}

/** Delete a namespaced key. */
export function nsDelete(namespace: string, key: string): void {
  callHost<void>('__localstoreDelete', undefined as any, namespace, key);
}

/** Clear one namespace, or all namespaces when empty. */
export function nsClear(namespace: string = ''): void {
  callHost<void>('__localstoreClear', undefined as any, namespace);
}

/** List keys inside one namespace (V8-only host). */
export function nsKeys(namespace: string): string[] {
  return callHostJson<string[]>('__localstoreKeysJson', [], namespace);
}

// ── Typed helpers ──────────────────────────────────────────────────

/** Get a value as JSON-decoded T. Returns fallback on miss or parse failure. */
export function getJson<T>(key: string, fallback: T): T {
  const raw = get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Set a value by JSON-encoding it. */
export function setJson(key: string, value: any): void {
  set(key, JSON.stringify(value));
}

// ── localStorage shim ──────────────────────────────────────────────
// Install as globalThis.localStorage so copy-pasted browser code just works.

export function installLocalStorageShim(): void {
  (globalThis as any).localStorage = {
    getItem: (k: string) => get(k),
    setItem: (k: string, v: string) => set(k, v),
    removeItem: (k: string) => remove(k),
    clear: () => clear(),
    key: (i: number) => keys()[i] ?? null,
    get length() { return keys().length; },
  };
}
