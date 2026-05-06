/**
 * ffi — generic helpers for calling Zig-side host functions.
 *
 * The Zig host registers functions on globalThis via qjs_runtime.registerHostFn
 * or JS_SetPropertyStr. From JS, you just call globalThis.__whatever(args). This
 * module wraps that pattern with type-safe helpers, availability checks, and a
 * listener registry so domain modules (fs, sqlite, http, crypto, …) stay small.
 *
 * Convention: Zig-registered globals are prefixed `__` (e.g. `__fs_read`,
 * `__sqlite_query`). Two groups exist today — `__<domain>_<op>` for new
 * per-domain bindings, and legacy names without a domain prefix (e.g.
 * `getFps`, `setNodeDim`, `__markDirty`) that predate the split.
 */

const host: any = (globalThis as any);

// ── Availability ───────────────────────────────────────────────────

/** True when the host has registered a function at `globalThis[name]`. */
export function hasHost(name: string): boolean {
  return typeof host[name] === 'function';
}

// ── Call ───────────────────────────────────────────────────────────

/**
 * Call a host function. Returns the result or `fallback` if the function
 * isn't registered. Use this when a feature is optional — the cart should
 * degrade gracefully when the Zig side hasn't been wired yet.
 */
export function callHost<T>(name: string, fallback: T, ...args: any[]): T {
  const fn = host[name];
  if (typeof fn !== 'function') return fallback;
  try { return fn(...args); } catch { return fallback; }
}

/**
 * Call a host function. Throws if it's not registered. Use this for
 * load-bearing ops where "not wired" should be a loud error, not silent
 * degradation.
 */
export function callHostStrict<T>(name: string, ...args: any[]): T {
  const fn = host[name];
  if (typeof fn !== 'function') {
    throw new Error(`ffi: host function '${name}' is not registered`);
  }
  return fn(...args);
}

// ── JSON I/O ──────────────────────────────────────────────────────
// Many host functions will return JSON strings (cheaper to cross the bridge
// as one string than as N FFI calls). Pair these with the Zig side using
// std.json.Stringify / std.json.parseFromSlice.

export function callHostJson<T>(name: string, fallback: T, ...args: any[]): T {
  const raw = callHost<string | null>(name, null, ...args);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ── Listener registry ─────────────────────────────────────────────
// One shared registry for both Zig-origin events (fs watchers, websocket
// frames, llama tokens, proc stdout, …) and JS-origin events (cart-side
// `emit()` calls, useIFTTT bus). Two emit paths into the same map:
//   - `emit(channel, payload)` — synchronous, for JS callers.
//   - `globalThis.__ffiEmit(channel, payload)` — deferred via setTimeout(0),
//     because Zig calls land during React commit phase and we don't want
//     subscriber setState to re-enter the in-flight render.

type FfiListener = (payload: any) => void;
type FfiWildcardListener = (channel: string, payload: any) => void;
const _listeners = new Map<string, Set<FfiListener>>();
const _wildcardListeners = new Set<FfiWildcardListener>();

export function subscribe(channel: string, fn: FfiListener): () => void {
  let set = _listeners.get(channel);
  if (!set) { set = new Set(); _listeners.set(channel, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

/** Subscribe to every channel. Listener receives (channel, payload).
 *  Used by transport bridges (vsock mirror, eventlog tap) that need to
 *  forward / record everything regardless of channel name. */
export function subscribeAll(fn: FfiWildcardListener): () => void {
  _wildcardListeners.add(fn);
  return () => { _wildcardListeners.delete(fn); };
}

function dispatchListeners(channel: string, payload: any): void {
  const set = _listeners.get(channel);
  if (set && set.size > 0) {
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (e: any) {
        console.error(`[ffi] ${channel} listener error:`, e?.message || e);
      }
    }
  }
  if (_wildcardListeners.size > 0) {
    for (const fn of Array.from(_wildcardListeners)) {
      try { fn(channel, payload); } catch (e: any) {
        console.error(`[ffi] wildcard listener error on ${channel}:`, e?.message || e);
      }
    }
  }
}

/** Synchronous emit — listeners fire in the same tick. Use for JS-origin
 *  events (UI handlers, useIFTTT bus). Zig-origin events go through
 *  `__ffiEmit` which defers to next tick. */
export function emit(channel: string, payload?: any): void {
  dispatchListeners(channel, payload);
}

(host as any).__ffiEmit = (channel: string, payload: any): void => {
  setTimeout(() => dispatchListeners(channel, payload), 0);
};
