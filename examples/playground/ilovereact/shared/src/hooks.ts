/**
 * Shared React hooks for Love2D communication.
 * These consume IBridge via context — they work identically
 * whether the transport is Module.FS (web) or QuickJS FFI (native).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useBridge } from './context';

/**
 * Subscribe to a Love2D event and get a send function.
 *
 * @example
 * const [gameState, send] = useLove('game:state', { ready: false });
 * send('player:move', { x: 100, y: 200 });
 */
export function useLove<T>(
  eventType: string,
  initialState: T
): [T, (cmd: string, payload?: any) => void] {
  const bridge = useBridge();
  const [state, setState] = useState<T>(initialState);

  useEffect(() => {
    return bridge.subscribe(eventType, (payload: T) => setState(payload));
  }, [bridge, eventType]);

  const send = useCallback(
    (cmd: string, payload?: any) => bridge.send(cmd, payload),
    [bridge]
  );

  return [state, send];
}

/**
 * Fire-and-forget event listener.
 *
 * @example
 * useLoveEvent('entity:spawned', (data) => console.log('Spawned:', data));
 */
export function useLoveEvent(
  eventType: string,
  handler: (payload: any) => void
) {
  const bridge = useBridge();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return bridge.subscribe(eventType, (payload) =>
      handlerRef.current(payload)
    );
  }, [bridge, eventType]);
}

/**
 * Call a Lua RPC method, await the result.
 *
 * @example
 * const getNearby = useLoveRPC<Entity[]>('getNearby');
 * const nearby = await getNearby({ x: 100, y: 200, range: 500 });
 */
export function useLoveRPC<T = any>(method: string) {
  const bridge = useBridge();
  return useCallback(
    (args?: any, timeoutMs?: number) =>
      bridge.rpc<T>(method, args, timeoutMs),
    [bridge, method]
  );
}

/**
 * Bidirectional shared state between React and Lua.
 *
 * @example
 * const [health, setHealth] = useLoveState('player.health', 100);
 */
export function useLoveState<T>(
  key: string,
  initialValue: T
): [T, (value: T) => void] {
  const bridge = useBridge();
  const [value, setLocal] = useState<T>(initialValue);

  useEffect(() => {
    return bridge.subscribe(`state:${key}`, (payload: T) =>
      setLocal(payload)
    );
  }, [bridge, key]);

  const setValue = useCallback(
    (newValue: T) => {
      setLocal(newValue);
      bridge.setState(key, newValue);
    },
    [bridge, key]
  );

  return [value, setValue];
}

/**
 * Returns true when the Love2D bridge is initialized and ready.
 */
export function useLoveReady(): boolean {
  const bridge = useBridge();
  const [ready, setReady] = useState(bridge.isReady());

  useEffect(() => {
    if (!ready) bridge.onReady(() => setReady(true));
  }, [bridge, ready]);

  return ready;
}

/**
 * Returns just the send function for fire-and-forget commands.
 */
export function useLoveSend() {
  const bridge = useBridge();
  return useCallback(
    (type: string, payload?: any) => bridge.send(type, payload),
    [bridge]
  );
}

/**
 * Position DOM overlays based on Love2D entity coordinates.
 * Only meaningful in web mode where React controls the DOM.
 */
export interface Overlay {
  id: string;
  nx: number;
  ny: number;
  px: number;
  py: number;
  domX?: number;
  domY?: number;
  [key: string]: any;
}

export function useLoveOverlays(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
): Overlay[] {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(() => {
      if (canvasRef.current)
        setRect(canvasRef.current.getBoundingClientRect());
    });
    observer.observe(canvasRef.current);
    setRect(canvasRef.current.getBoundingClientRect());
    return () => observer.disconnect();
  }, [canvasRef.current]);

  useLoveEvent('overlays', (data: Overlay[]) => setOverlays(data));

  if (!rect) return [];

  return overlays.map((o) => ({
    ...o,
    domX: o.nx * rect.width,
    domY: o.ny * rect.height,
  }));
}
