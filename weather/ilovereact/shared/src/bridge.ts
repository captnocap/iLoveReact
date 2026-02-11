/**
 * IBridge: the transport abstraction between React and Love2D.
 *
 * WebBridge implements this over Emscripten Module.FS (JSON files on shared ramdisk).
 * NativeBridge implements this over QuickJS FFI globals (__hostFlush, __hostGetEvents).
 *
 * All hooks consume IBridge via React context — they never know which transport is active.
 */

export interface BridgeEvent {
  type: string;
  payload: any;
}

export type Listener = (payload: any) => void;
export type Unsubscribe = () => void;

export interface IBridge {
  /** Queue a command for the Lua side. Batched until flush(). */
  send(type: string, payload?: any): void;

  /** Write all queued commands to the Lua side. */
  flush(): void;

  /** Subscribe to events from Lua. Returns unsubscribe function. */
  subscribe(type: string, fn: Listener): Unsubscribe;

  /** Call an RPC method on the Lua side, await the response. */
  rpc<T = any>(method: string, args?: any, timeoutMs?: number): Promise<T>;

  /** Set a shared state key (convenience wrapper over send). */
  setState(key: string, value: any): void;

  /** Whether the bridge transport is initialized and ready. */
  isReady(): boolean;

  /** Register a callback for when the bridge becomes ready. */
  onReady(callback: () => void): void;

  /** Tear down transport resources. */
  destroy(): void;
}
