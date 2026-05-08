/**
 * websocket — client-side WebSocket backed by framework/net/ (pure-Zig WS).
 *
 * Matches the browser WebSocket API shape. Tier 1 wrapper over useTheInternet.
 */

import { wsOpen, wsSend, wsClose, subscribe } from './useTheInternet';

type Handler = (ev: any) => void;

let _idSeq = 1;

export class ReactjitWebSocket {
  readonly id: number;
  readonly url: string;
  onopen: Handler | null = null;
  onmessage: Handler | null = null;
  onclose: Handler | null = null;
  onerror: Handler | null = null;
  private _unsubs: Array<() => void> = [];

  constructor(url: string) {
    this.id = _idSeq++;
    this.url = url;
    this._unsubs.push(subscribe(`ws:open:${this.id}`, () => { this.onopen?.({}); }));
    this._unsubs.push(subscribe(`ws:message:${this.id}`, (data) => { this.onmessage?.({ data }); }));
    this._unsubs.push(subscribe(`ws:close:${this.id}`, (p) => { this.onclose?.(p); this._cleanup(); }));
    this._unsubs.push(subscribe(`ws:error:${this.id}`, (msg) => { this.onerror?.({ message: msg }); }));
    wsOpen(this.id, url, '');
  }

  send(data: string): void {
    wsSend(this.id, data);
  }

  close(_code?: number, _reason?: string): void {
    wsClose(this.id);
    this._cleanup();
  }

  private _cleanup(): void {
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }
}

/** Install as `globalThis.WebSocket` so copy-pasted browser code works. */
export function installWebSocketShim(): void {
  (globalThis as any).WebSocket = ReactjitWebSocket;
}
