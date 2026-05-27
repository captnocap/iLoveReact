/**
 * useHost — single hook primitive for "this app hosts a server."
 *
 * Networking is split by direction:
 *   - useHost      — I bind a port. Server-side. Inbound only.
 *   - fetch()      — one-shot outbound request. (runtime/hooks/fetch.ts)
 *   - useConnection — persistent outbound channel. (runtime/hooks/useConnection.ts)
 *
 * Protocol is `kind`. Transport is `via:` (a handle from useConnection).
 *
 * Today: 'http' | 'ws'.
 */

import { useEffect, useRef, useState } from 'react';
import { useLatest } from './useLatest';
import {
  httpSrvListen,
  httpSrvRespond,
  httpSrvClose,
  wsSrvListen,
  wsSrvSend,
  wsSrvBroadcast,
  wsSrvClose,
  nextId,
  subscribe,
} from './useTheInternet';
import type { TransportHandle } from './useConnection';

// ── Spec types ─────────────────────────────────────────────────────

export interface HttpRequest {
  clientId: number;
  method: string;
  path: string;
  body: string;
}

export interface HttpResponder {
  send(status: number, contentType: string, body: string): void;
}

export interface HttpRouteSpec {
  path: string;
  kind?: 'handler' | 'static';
  root?: string;
}

interface SpecBase {
  via?: TransportHandle;
}

export interface HttpHostSpec extends SpecBase {
  kind: 'http';
  port: number;
  routes?: HttpRouteSpec[];
  onRequest?: (req: HttpRequest, res: HttpResponder) => void;
}

export interface WsHostSpec extends SpecBase {
  kind: 'ws';
  port: number;
  onOpen?: (clientId: number) => void;
  onMessage?: (clientId: number, data: string) => void;
  onClose?: (clientId: number) => void;
}

export type HostSpec = HttpHostSpec | WsHostSpec;

// ── Handle types ───────────────────────────────────────────────────

export type HostState = 'starting' | 'running' | 'stopped' | 'error';

interface HandleBase {
  id: number;
  kind: string;
  state: HostState;
  error?: string;
  stop(): void;
}

export interface HttpHostHandle extends HandleBase {
  kind: 'http';
  respond(clientId: number, status: number, contentType: string, body: string): void;
}

export interface WsHostHandle extends HandleBase {
  kind: 'ws';
  send(clientId: number, data: string): void;
  broadcast(data: string): void;
}

export type HostHandle = HttpHostHandle | WsHostHandle;

// ── Helpers ────────────────────────────────────────────────────────

const viaJson = (v?: TransportHandle): string =>
  v ? JSON.stringify({ id: v.id, kind: v.kind }) : '';

// ── Hook ───────────────────────────────────────────────────────────

export function useHost(spec: HttpHostSpec): HttpHostHandle;
export function useHost(spec: WsHostSpec): WsHostHandle;
export function useHost(spec: HostSpec): HostHandle {
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = nextId();
  const id = idRef.current;

  const [state, setState] = useState<HostState>('starting');
  const [error, setError] = useState<string | undefined>(undefined);

  const specRef = useLatest(spec);

  const routesKey = spec.kind === 'http' ? JSON.stringify(spec.routes ?? []) : '';
  const viaKey = spec.via ? `${spec.via.kind}:${spec.via.id}` : '';

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const via = viaJson(spec.via);

    if (spec.kind === 'http') {
      const routes = (specRef.current as HttpHostSpec).routes ?? [];
      httpSrvListen(id, spec.port, JSON.stringify(routes), via);

      unsubs.push(subscribe(`httpsrv:request:${id}`, (raw: any) => {
        if (cancelled) return;
        let req: HttpRequest;
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          req = { clientId: obj.clientId, method: obj.method, path: obj.path, body: obj.body };
        } catch { return; }
        const res: HttpResponder = {
          send: (status, contentType, body) =>
            httpSrvRespond(id, req.clientId, status, contentType, body),
        };
        const cb = (specRef.current as HttpHostSpec).onRequest;
        if (cb) cb(req, res);
        else res.send(404, 'text/plain', 'no handler');
      }));

      unsubs.push(subscribe(`httpsrv:error:${id}`, (raw: any) => {
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          setError(obj.error ?? 'unknown error');
        } catch { setError('unknown error'); }
        setState('error');
      }));

      setState('running');
    } else if (spec.kind === 'ws') {
      wsSrvListen(id, spec.port, via);

      unsubs.push(subscribe(`wssrv:open:${id}`, (raw: any) => {
        if (cancelled) return;
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          (specRef.current as WsHostSpec).onOpen?.(obj.clientId);
        } catch {}
      }));
      unsubs.push(subscribe(`wssrv:message:${id}`, (raw: any) => {
        if (cancelled) return;
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          (specRef.current as WsHostSpec).onMessage?.(obj.clientId, obj.data);
        } catch {}
      }));
      unsubs.push(subscribe(`wssrv:close:${id}`, (raw: any) => {
        if (cancelled) return;
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          (specRef.current as WsHostSpec).onClose?.(obj.clientId);
        } catch {}
      }));
      unsubs.push(subscribe(`wssrv:error:${id}`, (raw: any) => {
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          setError(obj.error ?? 'unknown error');
        } catch { setError('unknown error'); }
        setState('error');
      }));

      setState('running');
    }

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      if (spec.kind === 'http') httpSrvClose(id);
      else if (spec.kind === 'ws') wsSrvClose(id);
      setState('stopped');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.kind, (spec as any).port, routesKey, viaKey]);

  if (spec.kind === 'http') {
    return {
      kind: 'http',
      id,
      state,
      error,
      stop: () => httpSrvClose(id),
      respond: (clientId, status, contentType, body) =>
        httpSrvRespond(id, clientId, status, contentType, body),
    };
  }
  return {
    kind: 'ws',
    id,
    state,
    error,
    stop: () => wsSrvClose(id),
    send: (clientId, data) => wsSrvSend(id, clientId, data),
    broadcast: (data) => wsSrvBroadcast(id, data),
  };
}
