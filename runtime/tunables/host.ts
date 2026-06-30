// tunables/host.ts — the host DOOR onto resolved tunable values.
//
// Values that feed Zig systems (gravity, timeScale, walk speed, …) are consumed
// natively, not re-resolved in JS per frame. This door lets Zig ask the registry
// for a tunable's current numeric value. Until the Zig side wires `__tunable_get`,
// it degrades to the JS-resolved value (resolveCurrent) — mirroring the editorbus
// local-fallback pattern so the TS surface builds, tests, and runs now.
//
// Direction of truth: the active selection is set on the JS side via ./events.ts
// (which logs onto the authoring bus); the host reads the resolved number back
// out through this door when it needs the scalar.

import { callHost } from '../ffi';
import { resolveCurrent } from './tunable';

// ── Host-door contract (the Zig side implements this) ────────────────────────
declare module '../ffi' {
  interface HostCalls {
    /** Resolve a tunable to its current numeric value host-side. Returns the
     *  scalar a Zig system consumes (preset factor × base, or a custom override). */
    __tunable_get(id: string): number;
  }
}

/**
 * Current numeric value of a tunable. Calls the host door when wired; otherwise
 * falls back to the JS-resolved value so cart code works before the Zig door lands.
 * `resolveCurrent` throws on an unknown id (an authoring bug, not a soft miss).
 */
export function tunableGet(id: string): number {
  const local = resolveCurrent(id);
  return callHost('__tunable_get', local, id);
}
