/**
 * usePointerDevice — which physical device is driving the cursor right now:
 * 'mouse' or 'pen' (Wacom/tablet stylus).
 *
 * The host (engine.zig) classifies every pointer event by its SDL device id —
 * pen-synthesized mouse events carry SDL_PEN_MOUSEID — and fires the
 * `system:pointerDevice` bus signal on the change edge. A pen entering hover
 * range of the tablet (proximity, before it touches) already flips to 'pen',
 * so a device-keyed tool swap lands before the first contact.
 *
 * This is the GIMP pattern: let a cart remember a tool per device, so the pen
 * paints while the mouse keeps pulling vertices, with no manual toggle.
 *
 * @example
 *   const device = usePointerDevice();          // 'mouse' | 'pen', re-renders on flip
 *   // non-hook readers (event handlers, imperative stores):
 *   if (getPointerDevice() === 'pen') ...
 */
import { useEffect, useState } from 'react';
import { subscribe } from '../ffi';

export type PointerDevice = 'mouse' | 'pen';

/** Instantaneous read of the host's device tracker (no subscription). */
export function getPointerDevice(): PointerDevice {
  const fn = (globalThis as any).getPointerDevice;
  return typeof fn === 'function' && Number(fn()) > 0 ? 'pen' : 'mouse';
}

export function usePointerDevice(): PointerDevice {
  const [device, setDevice] = useState<PointerDevice>(getPointerDevice);
  useEffect(() => subscribe('system:pointerDevice', (p: any) => {
    setDevice(p?.device === 'pen' ? 'pen' : 'mouse');
  }), []);
  return device;
}
