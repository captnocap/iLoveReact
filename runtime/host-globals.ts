/**
 * host-globals — typed view of the `__` namespace on globalThis.
 *
 * The Zig host attaches functions and reverse-dispatch callbacks onto
 * globalThis under the `__` prefix. JS code reaches them through this
 * single typed `G` handle instead of casting `globalThis as any` in
 * every file.
 *
 * Each subsystem adds its globals via TypeScript module augmentation:
 *
 *   declare module '@reactjit/runtime/host-globals' {
 *     interface HostGlobals {
 *       __my_thing(arg: number): void;
 *     }
 *   }
 *
 * Both Zig→JS dispatch hooks (the ones JS sets so Zig can call back)
 * and JS→Zig call entries (the ones Zig sets so JS can call forward)
 * live in the same interface — they're all reachable on globalThis.
 *
 * Idempotence flags (`__ifttt_handlers_installed`, etc.) are also
 * declared here so the "set once" pattern type-checks without casts.
 */

/* eslint-disable @typescript-eslint/consistent-type-definitions */
export interface HostGlobals {
  /* Generic FFI dispatch — see runtime/ffi.ts */
  __ffiEmit?(channel: string, payload: unknown): void;
}

export const G = globalThis as unknown as HostGlobals & typeof globalThis;
