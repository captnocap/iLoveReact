/**
 * ids — branded numeric handles for the Zig-side IFTTT registry.
 *
 * Wire / Key / Timer IDs are all `number` on the wire (FFI handles),
 * but mixing them in JS would let `wireFree(keyId)` type-check. The
 * brand prevents that without runtime cost.
 *
 *   const wid: WireId = WireId(host_alloc());
 *   freeWire(wid);             // ok
 *   freeWire(keyId as any);    // would type-check, but cast is the audit trail
 */

declare const WireIdBrand: unique symbol;
declare const KeyIdBrand: unique symbol;
declare const TimerIdBrand: unique symbol;

export type WireId = number & { readonly [WireIdBrand]: true };
export type KeyId = number & { readonly [KeyIdBrand]: true };
export type TimerId = number & { readonly [TimerIdBrand]: true };

export const WireId = (n: number): WireId => n as WireId;
export const KeyId = (n: number): KeyId => n as KeyId;
export const TimerId = (n: number): TimerId => n as TimerId;

/** Sentinel for "not allocated" — every alloc path returns <=0 on failure. */
export const NO_WIRE = 0 as WireId;
export const NO_KEY = 0 as KeyId;
export const NO_TIMER = 0 as TimerId;
