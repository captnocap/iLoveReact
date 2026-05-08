/**
 * useConnection — single hook primitive for "this app holds an outbound channel."
 *
 * Networking in reactjit is split by **direction**:
 *   - useHost      — I bind a port / I own a process. Server-side.
 *   - fetch()      — one-shot outbound request, no persistent state.
 *   - useConnection — persistent outbound channel I don't own the other end of.
 *
 * Protocol is `kind`. Transport is `via:` (a handle returned from another
 * useHost / useConnection call). Transports compose recursively:
 *
 *   const wg  = useConnection({ kind: 'wireguard', config });
 *   const tor = useConnection({ kind: 'tor' });
 *   const tcp = useConnection({ kind: 'tcp', host, port, via: wg });
 *   fetch(url, { via: tor });
 *
 * Today, wired end-to-end:
 *   ws / tcp / udp  — __ws_*, __tcp_*, __udp_*
 *   tor             — __tor_start spawns a Tor process, emits tor:open with
 *                     {socksPort,hostname,hsPort} once bootstrap completes
 *   socks5          — __socks5_register stashes the proxy spec; via:socks5
 *                     handles route through it via socks5.connect at the
 *                     Zig binding boundary
 *   via: tcp        — kind:'tcp' with via:tor or via:socks5 is honored by
 *                     v8_bindings_net.zig (calls socks5.connect → wraps the
 *                     tunneled stream in TcpClient.fromStream)
 *
 * Not yet wired (will report state:'error'):
 *   wireguard / stun / peer  — no Zig backend yet.
 *   via: ws / udp / fetch    — only the tcp dispatch path is implemented.
 */

import { useEffect, useRef, useState } from 'react';
import {
  nextId,
  subscribe,
  wsOpen,
  wsSend,
  wsClose,
  tcpConnect,
  tcpSend,
  tcpClose,
  udpOpen,
  udpSend,
  udpClose,
  torStart,
  torStop,
  socks5Register,
  socks5Unregister,
  httpStreamOpen,
  httpStreamClose,
  rconOpen,
  rconClose,
  rconCommand,
  a2sOpen,
  a2sClose,
  a2sQuery,
} from './useTheInternet';

// ── Common ─────────────────────────────────────────────────────────

export type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

/** Anything that returns a `{ id, kind }` handle can be used as `via:`. */
export interface TransportHandle {
  id: number;
  kind: string;
}

interface SpecBase {
  /** Route this connection through another transport handle (wg/tor/socks5/...). */
  via?: TransportHandle;
}

// ── Spec types ─────────────────────────────────────────────────────

export interface WsConnectionSpec extends SpecBase {
  kind: 'ws';
  url: string;
  protocols?: string[];
  onOpen?: () => void;
  onMessage?: (data: string) => void;
  onClose?: (info: { code: number; reason: string }) => void;
  onError?: (msg: string) => void;
}

export interface TcpConnectionSpec extends SpecBase {
  kind: 'tcp';
  host: string;
  port: number;
  onData?: (data: string) => void;
  onClose?: () => void;
  onError?: (msg: string) => void;
}

export interface UdpConnectionSpec extends SpecBase {
  kind: 'udp';
  host: string;
  port: number;
  onPacket?: (data: string) => void;
  onError?: (msg: string) => void;
}

export interface WireGuardConnectionSpec extends SpecBase {
  kind: 'wireguard';
  /** Raw wg-quick-style config text, OR structured config. */
  config: string | WireGuardConfig;
  /** Linux interface name to bring up. Default: derived. */
  interfaceName?: string;
}

export interface WireGuardConfig {
  privateKey: string;
  address: string[];
  dns?: string[];
  peers: Array<{
    publicKey: string;
    presharedKey?: string;
    allowedIPs: string[];
    endpoint?: string;
    persistentKeepalive?: number;
  }>;
}

export interface TorConnectionSpec extends SpecBase {
  kind: 'tor';
  /** SOCKS port for outbound; default 9050 (assume system tor) or spawn embedded. */
  socksPort?: number;
  /** If true, spawn an embedded tor daemon instead of using a system one. */
  embedded?: boolean;
}

export interface Socks5ConnectionSpec extends SpecBase {
  kind: 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface StunConnectionSpec extends SpecBase {
  kind: 'stun';
  /** STUN server, e.g. 'stun.l.google.com:19302'. */
  server: string;
  onMapped?: (info: { externalIp: string; externalPort: number }) => void;
}

export interface PeerConnectionSpec extends SpecBase {
  kind: 'peer';
  /** Peer-tunnel identity / signaling address. */
  peerId: string;
  onData?: (data: string) => void;
}

/**
 * Streaming HTTP response — the request fires once and chunks of the body
 * arrive on `onChunk` as they're received from the server. `onComplete`
 * fires once with the final status when the response ends. Useful for
 * large downloads, progressive renderers, and streaming LLM bodies that
 * aren't formatted as SSE.
 *
 * Cancellation note: closing the handle stops listening but cannot abort
 * an in-flight libcurl perform, so chunks may continue accumulating
 * server-side until the connection naturally ends.
 */
export interface HttpConnectionSpec extends SpecBase {
  kind: 'http';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  onChunk?: (data: string) => void;
  onComplete?: (info: { status: number }) => void;
  onError?: (msg: string) => void;
}

export interface SseEvent {
  /** Event name (default: 'message'). */
  event: string;
  /** Payload string — joined `data:` lines without trailing newline. */
  data: string;
  /** Optional `id:` from the server. */
  id?: string;
  /** Optional retry hint in ms. */
  retry?: number;
}

/**
 * Server-Sent Events. Same wire as `kind:'http'` but the chunk stream is
 * parsed into discrete events. Forces `Accept: text/event-stream`. Use
 * this for OpenAI/Anthropic streaming endpoints, gradio progress streams,
 * Ollama, etc.
 */
export interface SseConnectionSpec extends SpecBase {
  kind: 'sse';
  url: string;
  headers?: Record<string, string>;
  /** POST body, if the SSE endpoint expects one (Anthropic does). Defaults to GET when omitted. */
  body?: string;
  onEvent?: (ev: SseEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (msg: string) => void;
}

/**
 * Source RCON — Valve's TCP admin protocol for GoldSrc / Source / Source 2 /
 * Minecraft dedicated servers. The full binary handshake (auth packet, AUTH_RESPONSE,
 * EXEC_COMMAND framing, multi-packet response merging via marker echo) happens
 * in `framework/net/rcon.zig`. JS only sees the textual command output.
 */
export interface RconConnectionSpec extends SpecBase {
  kind: 'rcon';
  host: string;
  port: number;
  password: string;
  onAuth?: (ok: boolean) => void;
  onResponse?: (info: { requestId: number; body: string }) => void;
  onClose?: () => void;
  onError?: (msg: string) => void;
}

export interface A2sInfo {
  format: 'source' | 'goldsrc';
  protocol: number;
  name: string;
  map: string;
  folder: string;
  game: string;
  steamAppId?: number;
  players: number;
  maxPlayers: number;
  bots?: number;
  serverType?: number;
  environment?: number;
  visibility?: number;
  vac?: number;
  version?: string;
  address?: string;
}

export interface A2sPlayer {
  index: number;
  name: string;
  score: number;
  duration: number;
}

/**
 * A2S Source Query — UDP server-browser protocol. Same across all Valve
 * engines. Binary parsing (challenge handshake, IEEE 754 float decoding,
 * cstring framing) happens in `framework/net/a2s.zig`; JS gets parsed
 * objects via JSON.
 */
export interface A2sConnectionSpec extends SpecBase {
  kind: 'a2s';
  host: string;
  port: number;
  onInfo?: (info: A2sInfo) => void;
  onPlayers?: (players: A2sPlayer[]) => void;
  onRules?: (rules: Record<string, string>) => void;
  onError?: (msg: string) => void;
}

export type ConnectionSpec =
  | WsConnectionSpec
  | TcpConnectionSpec
  | UdpConnectionSpec
  | WireGuardConnectionSpec
  | TorConnectionSpec
  | Socks5ConnectionSpec
  | StunConnectionSpec
  | PeerConnectionSpec
  | HttpConnectionSpec
  | SseConnectionSpec
  | RconConnectionSpec
  | A2sConnectionSpec;

// ── Handle types (discriminated by kind) ───────────────────────────

interface HandleBase {
  id: number;
  state: ConnectionState;
  error?: string;
  close(): void;
}

export interface WsConnectionHandle extends HandleBase {
  kind: 'ws';
  send(data: string): void;
}

export interface TcpConnectionHandle extends HandleBase {
  kind: 'tcp';
  send(data: string): void;
}

export interface UdpConnectionHandle extends HandleBase {
  kind: 'udp';
  send(data: string): void;
}

export interface WireGuardConnectionHandle extends HandleBase {
  kind: 'wireguard';
  /** Public key for this side of the tunnel, once the interface is up. */
  publicKey?: string;
}

export interface TorConnectionHandle extends HandleBase {
  kind: 'tor';
  /** SOCKS port to route through. 0 until state === 'open'. */
  socksPort: number;
  /** .onion hostname for the cart's hidden service. Undefined until 'open'. */
  hostname?: string;
  /** Local port the hidden service forwards to. 0 until 'open'. */
  hsPort: number;
}

export interface Socks5ConnectionHandle extends HandleBase {
  kind: 'socks5';
}

export interface StunConnectionHandle extends HandleBase {
  kind: 'stun';
  externalIp?: string;
  externalPort?: number;
}

export interface PeerConnectionHandle extends HandleBase {
  kind: 'peer';
  send(data: string): void;
}

export interface HttpConnectionHandle extends HandleBase {
  kind: 'http';
  /** HTTP response status. 0 until `state === 'closed'`. */
  status: number;
}

export interface SseConnectionHandle extends HandleBase {
  kind: 'sse';
}

export interface RconConnectionHandle extends HandleBase {
  kind: 'rcon';
  /** True after AUTH_RESPONSE arrives with id != -1. */
  authenticated: boolean;
  /**
   * Send a command. Returns the request id that will appear on the matching
   * `onResponse({requestId, body})`. Calling before authentication completes
   * fires `onError`; the command is dropped.
   */
  command(cmd: string): number;
}

export interface A2sConnectionHandle extends HandleBase {
  kind: 'a2s';
  queryInfo(): void;
  queryPlayers(): void;
  queryRules(): void;
}

export type ConnectionHandle =
  | WsConnectionHandle
  | TcpConnectionHandle
  | UdpConnectionHandle
  | WireGuardConnectionHandle
  | TorConnectionHandle
  | Socks5ConnectionHandle
  | StunConnectionHandle
  | PeerConnectionHandle
  | HttpConnectionHandle
  | SseConnectionHandle
  | RconConnectionHandle
  | A2sConnectionHandle;

// ── ID allocator ───────────────────────────────────────────────────



const viaJson = (v?: TransportHandle): string =>
  v ? JSON.stringify({ id: v.id, kind: v.kind }) : '';

// ── Hook ───────────────────────────────────────────────────────────

export function useConnection(spec: WsConnectionSpec): WsConnectionHandle;
export function useConnection(spec: TcpConnectionSpec): TcpConnectionHandle;
export function useConnection(spec: UdpConnectionSpec): UdpConnectionHandle;
export function useConnection(spec: WireGuardConnectionSpec): WireGuardConnectionHandle;
export function useConnection(spec: TorConnectionSpec): TorConnectionHandle;
export function useConnection(spec: Socks5ConnectionSpec): Socks5ConnectionHandle;
export function useConnection(spec: StunConnectionSpec): StunConnectionHandle;
export function useConnection(spec: PeerConnectionSpec): PeerConnectionHandle;
export function useConnection(spec: HttpConnectionSpec): HttpConnectionHandle;
export function useConnection(spec: SseConnectionSpec): SseConnectionHandle;
export function useConnection(spec: RconConnectionSpec): RconConnectionHandle;
export function useConnection(spec: A2sConnectionSpec): A2sConnectionHandle;
export function useConnection(spec: ConnectionSpec): ConnectionHandle {
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = nextId();
  const id = idRef.current;

  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | undefined>(undefined);
  // Tor only — populated when bootstrap completes.
  const [torInfo, setTorInfo] = useState<{ socksPort: number; hostname: string; hsPort: number } | undefined>(undefined);
  const torInfoRef = useRef<typeof torInfo>(undefined);
  // http / sse only — populated on .complete from http-stream-end.
  const [httpStatus, setHttpStatus] = useState<number>(0);
  // rcon only — flips on AUTH_RESPONSE.
  const [rconAuthed, setRconAuthed] = useState<boolean>(false);
  const rconReqSeq = useRef<number>(1);

  const specRef = useRef(spec);
  specRef.current = spec;

  const viaKey = spec.via ? `${spec.via.kind}:${spec.via.id}` : '';

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const via = viaJson(spec.via);

    if (spec.kind === 'ws') {
      wsOpen(id, spec.url, via);
      unsubs.push(subscribe(`ws:open:${id}`, () => {
        if (cancelled) return;
        (specRef.current as WsConnectionSpec).onOpen?.();
        setState('open');
      }));
      unsubs.push(subscribe(`ws:message:${id}`, (data: any) => {
        if (cancelled) return;
        const s = typeof data === 'string' ? data : String(data);
        (specRef.current as WsConnectionSpec).onMessage?.(s);
      }));
      unsubs.push(subscribe(`ws:close:${id}`, (raw: any) => {
        if (cancelled) return;
        let info = { code: 0, reason: '' };
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          info = { code: obj.code ?? 0, reason: obj.reason ?? '' };
        } catch {}
        (specRef.current as WsConnectionSpec).onClose?.(info);
        setState('closed');
      }));
      unsubs.push(subscribe(`ws:error:${id}`, (msg: any) => {
        if (cancelled) return;
        const m = typeof msg === 'string' ? msg : String(msg);
        (specRef.current as WsConnectionSpec).onError?.(m);
        setError(m);
        setState('error');
      }));
    } else if (spec.kind === 'tcp') {
      tcpConnect(id, spec.host, spec.port, via);
      unsubs.push(subscribe(`tcp:open:${id}`, () => {
        if (cancelled) return;
        setState('open');
      }));
      unsubs.push(subscribe(`tcp:data:${id}`, (data: any) => {
        if (cancelled) return;
        const s = typeof data === 'string' ? data : String(data);
        (specRef.current as TcpConnectionSpec).onData?.(s);
      }));
      unsubs.push(subscribe(`tcp:close:${id}`, () => {
        if (cancelled) return;
        (specRef.current as TcpConnectionSpec).onClose?.();
        setState('closed');
      }));
      unsubs.push(subscribe(`tcp:error:${id}`, (msg: any) => {
        if (cancelled) return;
        const m = typeof msg === 'string' ? msg : String(msg);
        (specRef.current as TcpConnectionSpec).onError?.(m);
        setError(m);
        setState('error');
      }));
      // tcp_connect is sync today; flip to open optimistically if no event arrives.
      setState('open');
    } else if (spec.kind === 'udp') {
      udpOpen(id, spec.host, spec.port, via);
      unsubs.push(subscribe(`udp:packet:${id}`, (data: any) => {
        if (cancelled) return;
        const s = typeof data === 'string' ? data : String(data);
        (specRef.current as UdpConnectionSpec).onPacket?.(s);
      }));
      unsubs.push(subscribe(`udp:error:${id}`, (msg: any) => {
        if (cancelled) return;
        const m = typeof msg === 'string' ? msg : String(msg);
        (specRef.current as UdpConnectionSpec).onError?.(m);
        setError(m);
        setState('error');
      }));
      setState('open');
    } else if (spec.kind === 'tor') {
      const opts = JSON.stringify({
        identity: (spec as TorConnectionSpec).socksPort ? '' : 'default',
        socksPort: (spec as TorConnectionSpec).socksPort ?? 0,
      });
      torStart(id, opts);
      unsubs.push(subscribe(`tor:open:${id}`, (raw: any) => {
        if (cancelled) return;
        try {
          const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          torInfoRef.current = { socksPort: obj.socksPort, hostname: obj.hostname, hsPort: obj.hsPort };
          setTorInfo(torInfoRef.current);
        } catch {}
        setState('open');
      }));
      unsubs.push(subscribe(`tor:error:${id}`, (msg: any) => {
        if (cancelled) return;
        const m = typeof msg === 'string' ? msg : String(msg);
        setError(m);
        setState('error');
      }));
    } else if (spec.kind === 'socks5') {
      socks5Register(id, spec.host, spec.port, spec.username ?? '', spec.password ?? '');
      // SOCKS5 is a config holder — no socket opens here. The proxy is used
      // when another connection passes this handle as `via:`.
      setState('open');
    } else if (spec.kind === 'http' || spec.kind === 'sse') {
      const rid = `c${id}`;
      const isSse = spec.kind === 'sse';
      const headers: Record<string, string> = { ...(spec.headers ?? {}) };
      if (isSse) {
        headers['Accept'] = 'text/event-stream';
        if (!('Cache-Control' in headers)) headers['Cache-Control'] = 'no-cache';
      }
      const reqJson = JSON.stringify({
        method: ((spec as any).method ?? (((spec as SseConnectionSpec).body !== undefined && isSse) || ((spec as HttpConnectionSpec).body !== undefined && !isSse) ? 'POST' : 'GET')).toUpperCase(),
        url: spec.url,
        headers,
        body: (spec as any).body,
      });

      // SSE parser state — only used when isSse, but cheap to allocate.
      let leftover = '';
      let evName = 'message';
      let evData = '';
      let evId: string | undefined;
      let evRetry: number | undefined;
      const dispatchSse = () => {
        if (evData === '' && evName === 'message' && evId === undefined && evRetry === undefined) {
          return; // empty event — ignore
        }
        const ev: SseEvent = { event: evName, data: evData };
        if (evId !== undefined) ev.id = evId;
        if (evRetry !== undefined) ev.retry = evRetry;
        (specRef.current as SseConnectionSpec).onEvent?.(ev);
        evName = 'message';
        evData = '';
        evId = undefined;
        evRetry = undefined;
      };
      const feedSse = (incoming: string) => {
        const buf = leftover + incoming;
        // SSE allows \n, \r, or \r\n line breaks.
        const lines = buf.split(/\r\n|\r|\n/);
        leftover = lines.pop() ?? '';
        for (const line of lines) {
          if (line === '') { dispatchSse(); continue; }
          if (line.startsWith(':')) continue; // comment
          const sep = line.indexOf(':');
          const field = sep === -1 ? line : line.slice(0, sep);
          let value = sep === -1 ? '' : line.slice(sep + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') evName = value;
          else if (field === 'data') evData = evData === '' ? value : `${evData}\n${value}`;
          else if (field === 'id') evId = value;
          else if (field === 'retry') {
            const n = Number(value);
            if (!Number.isNaN(n)) evRetry = n;
          }
        }
      };

      httpStreamOpen(reqJson, rid);

      // Optimistically flip to open — server byte arrival is the real signal,
      // but the request is in flight as soon as the host fn returns. SSE fires
      // onOpen here too; the spec is "connection established," not "first event."
      setState('open');
      if (isSse) (specRef.current as SseConnectionSpec).onOpen?.();

      unsubs.push(subscribe(`http-stream:${rid}`, (data: any) => {
        if (cancelled) return;
        const s = typeof data === 'string' ? data : String(data);
        if (isSse) feedSse(s);
        else (specRef.current as HttpConnectionSpec).onChunk?.(s);
      }));

      unsubs.push(subscribe(`http-stream-end:${rid}`, (raw: any) => {
        if (cancelled) return;
        let obj: any = {};
        try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
        if (typeof obj.error === 'string') {
          if (isSse) (specRef.current as SseConnectionSpec).onError?.(obj.error);
          else (specRef.current as HttpConnectionSpec).onError?.(obj.error);
          setError(obj.error);
          setState('error');
        } else {
          if (isSse && leftover !== '') { feedSse('\n'); } // flush trailing
          if (typeof obj.status === 'number') setHttpStatus(obj.status);
          if (isSse) (specRef.current as SseConnectionSpec).onClose?.();
          else (specRef.current as HttpConnectionSpec).onComplete?.({ status: obj.status ?? 0 });
          setState('closed');
        }
      }));
    } else if (spec.kind === 'rcon') {
      rconOpen(id, spec.host, spec.port, spec.password);
      // The Zig side already framed and sent the AUTH packet. We optimistically
      // mark connecting → 'open' (TCP up, awaiting AUTH_RESPONSE); 'authed'
      // is tracked separately on the handle.
      setState('open');
      unsubs.push(subscribe(`rcon:auth:${id}`, (raw: any) => {
        if (cancelled) return;
        let obj: any = {};
        try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
        const ok = !!obj.ok;
        setRconAuthed(ok);
        (specRef.current as RconConnectionSpec).onAuth?.(ok);
        if (!ok) setState('error');
      }));
      unsubs.push(subscribe(`rcon:response:${id}`, (raw: any) => {
        if (cancelled) return;
        let obj: any = {};
        try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
        (specRef.current as RconConnectionSpec).onResponse?.({
          requestId: obj.requestId ?? 0,
          body: obj.body ?? '',
        });
      }));
      unsubs.push(subscribe(`rcon:close:${id}`, () => {
        if (cancelled) return;
        (specRef.current as RconConnectionSpec).onClose?.();
        setState('closed');
      }));
      unsubs.push(subscribe(`rcon:error:${id}`, (msg: any) => {
        if (cancelled) return;
        const m = typeof msg === 'string' ? msg : String(msg);
        (specRef.current as RconConnectionSpec).onError?.(m);
        setError(m);
        setState('error');
      }));
    } else if (spec.kind === 'a2s') {
      a2sOpen(id, spec.host, spec.port);
      setState('open');
      unsubs.push(subscribe(`a2s:info:${id}`, (raw: any) => {
        if (cancelled) return;
        try {
          const info = typeof raw === 'string' ? JSON.parse(raw) : raw;
          (specRef.current as A2sConnectionSpec).onInfo?.(info);
        } catch {}
      }));
      unsubs.push(subscribe(`a2s:players:${id}`, (raw: any) => {
        if (cancelled) return;
        try {
          const players = typeof raw === 'string' ? JSON.parse(raw) : raw;
          (specRef.current as A2sConnectionSpec).onPlayers?.(players);
        } catch {}
      }));
      unsubs.push(subscribe(`a2s:rules:${id}`, (raw: any) => {
        if (cancelled) return;
        try {
          const rules = typeof raw === 'string' ? JSON.parse(raw) : raw;
          (specRef.current as A2sConnectionSpec).onRules?.(rules);
        } catch {}
      }));
      unsubs.push(subscribe(`a2s:error:${id}`, (msg: any) => {
        if (cancelled) return;
        const m = typeof msg === 'string' ? msg : String(msg);
        (specRef.current as A2sConnectionSpec).onError?.(m);
        setError(m);
        setState('error');
      }));
    } else {
      // wireguard / stun / peer: no Zig backend yet. Honest error rather
      // than a silent open. When the binding lands, replace with real wiring.
      setError(`${spec.kind} transport: zig backend not yet implemented`);
      setState('error');
    }

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      if (spec.kind === 'ws') wsClose(id);
      else if (spec.kind === 'tcp') tcpClose(id);
      else if (spec.kind === 'udp') udpClose(id);
      else if (spec.kind === 'tor') torStop(id);
      else if (spec.kind === 'socks5') socks5Unregister(id);
      else if (spec.kind === 'http' || spec.kind === 'sse') httpStreamClose(`c${id}`);
      else if (spec.kind === 'rcon') rconClose(id);
      else if (spec.kind === 'a2s') a2sClose(id);
      setState('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    spec.kind,
    (spec as any).url,
    (spec as any).host,
    (spec as any).port,
    (spec as any).server,
    (spec as any).peerId,
    viaKey,
  ]);

  // Build the kind-specific handle.
  const closeFn = () => {
    if (spec.kind === 'ws') wsClose(id);
    else if (spec.kind === 'tcp') tcpClose(id);
    else if (spec.kind === 'udp') udpClose(id);
    else if (spec.kind === 'http' || spec.kind === 'sse') httpStreamClose(`c${id}`);
    else if (spec.kind === 'rcon') rconClose(id);
    else if (spec.kind === 'a2s') a2sClose(id);
  };

  if (spec.kind === 'ws') {
    return {
      kind: 'ws', id, state, error, close: closeFn,
      send: (data) => wsSend(id, data),
    };
  }
  if (spec.kind === 'tcp') {
    return {
      kind: 'tcp', id, state, error, close: closeFn,
      send: (data) => tcpSend(id, data),
    };
  }
  if (spec.kind === 'udp') {
    return {
      kind: 'udp', id, state, error, close: closeFn,
      send: (data) => udpSend(id, data),
    };
  }
  if (spec.kind === 'wireguard') {
    return { kind: 'wireguard', id, state, error, close: closeFn };
  }
  if (spec.kind === 'tor') {
    return {
      kind: 'tor',
      id,
      state,
      error,
      close: closeFn,
      socksPort: torInfo?.socksPort ?? spec.socksPort ?? 0,
      hostname: torInfo?.hostname,
      hsPort: torInfo?.hsPort ?? 0,
    };
  }
  if (spec.kind === 'socks5') {
    return { kind: 'socks5', id, state, error, close: closeFn };
  }
  if (spec.kind === 'stun') {
    return { kind: 'stun', id, state, error, close: closeFn };
  }
  if (spec.kind === 'http') {
    return { kind: 'http', id, state, error, close: closeFn, status: httpStatus };
  }
  if (spec.kind === 'sse') {
    return { kind: 'sse', id, state, error, close: closeFn };
  }
  if (spec.kind === 'rcon') {
    return {
      kind: 'rcon', id, state, error, close: closeFn,
      authenticated: rconAuthed,
      command: (cmd: string) => {
        const reqId = rconReqSeq.current++;
        rconCommand(id, reqId, cmd);
        return reqId;
      },
    };
  }
  if (spec.kind === 'a2s') {
    return {
      kind: 'a2s', id, state, error, close: closeFn,
      queryInfo: () => a2sQuery(id, 'info'),
      queryPlayers: () => a2sQuery(id, 'players'),
      queryRules: () => a2sQuery(id, 'rules'),
    };
  }
  // peer
  return {
    kind: 'peer', id, state, error, close: closeFn,
    send: (_data: string) => { /* not wired */ },
  };
}
