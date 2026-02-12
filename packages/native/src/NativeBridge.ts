/**
 * NativeBridge: IBridge implementation for the QuickJS FFI context.
 *
 * In native mode, Lua calls into JS each frame — no rAF polling needed.
 * The bridge is immediately ready since QuickJS globals are available at startup.
 *
 * Commands are queued via send() and flushed to Lua via globalThis.__hostFlush.
 * Events from Lua are polled via globalThis.__hostGetEvents and dispatched to listeners.
 */

import type { IBridge, Listener, Unsubscribe, BridgeEvent } from '../../shared/src/bridge';
import { initEventDispatching } from './eventDispatcher';
import { reportError } from './errorReporter';
import { setTransportFlush } from './hostConfig';

declare const globalThis: {
  __hostFlush: (commands: any[]) => void;
  __hostGetEvents: () => any[];
  _pollAndDispatchEvents?: () => void;
  [key: string]: any;
};

interface Command {
  type: string;
  payload?: any;
}

let rpcIdCounter = 0;

export class NativeBridge implements IBridge {
  private commandQueue: Command[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private ready = true;
  private readyCallbacks: Array<() => void> = [];

  constructor() {
    // Register this transport's flush handler with the reconciler
    setTransportFlush((commands) => globalThis.__hostFlush(commands));

    // Expose the event polling function globally so Lua can call it each frame
    globalThis._pollAndDispatchEvents = () => this.pollAndDispatchEvents();

    // Initialize event dispatching (connects bridge events to handlerRegistry)
    initEventDispatching(this);
  }

  send(type: string, payload?: any): void {
    this.commandQueue.push({ type, payload });
  }

  flush(): void {
    if (this.commandQueue.length === 0) return;
    globalThis.__hostFlush(this.commandQueue);
    this.commandQueue = [];
  }

  subscribe(type: string, fn: Listener): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);

    return () => {
      set!.delete(fn);
      if (set!.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  rpc<T = any>(method: string, args?: any, timeoutMs = 5000): Promise<T> {
    const id = ++rpcIdCounter;
    const responseType = `rpc:${id}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`RPC '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsub = this.subscribe(responseType, (payload: any) => {
        clearTimeout(timer);
        unsub();
        if (payload && payload.error) {
          reject(new Error(payload.error));
        } else {
          resolve(payload as T);
        }
      });

      this.send('rpc:call', { id, method, args });
      this.flush(); // Send immediately so Lua can process in current frame
    });
  }

  setState(key: string, value: any): void {
    this.send('state:update', { key, value });
  }

  isReady(): boolean {
    return this.ready;
  }

  onReady(callback: () => void): void {
    if (this.ready) {
      callback();
    } else {
      this.readyCallbacks.push(callback);
    }
  }

  destroy(): void {
    this.listeners.clear();
    this.commandQueue = [];
    delete globalThis._pollAndDispatchEvents;
  }

  /**
   * Poll events from the Lua side and dispatch to subscribers.
   * Called by Lua each frame via globalThis._pollAndDispatchEvents.
   */
  private pollAndDispatchEvents(): void {
    let events: any;
    try {
      events = globalThis.__hostGetEvents();
    } catch (e: any) {
      reportError(e, '__hostGetEvents()');
      return;
    }

    if (!events || events.length === 0) return;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event || !event.type) continue;
      const set = this.listeners.get(event.type);
      if (set) {
        for (const fn of set) {
          try {
            fn(event.payload);
          } catch (e: any) {
            reportError(e, 'event handler (' + event.type + ')');
          }
        }
      }
    }
  }
}
