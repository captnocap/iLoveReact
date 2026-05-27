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
import { useLatest } from './useLatest';
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

type Unsubscribe = () => void;

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

// ── Kind-indexed maps ──────────────────────────────────────────────

export type ConnectionKind = ConnectionSpec['kind'];
export type SpecByKind   = { [K in ConnectionKind]: Extract<ConnectionSpec,   { kind: K }> };
export type HandleByKind = { [K in ConnectionKind]: Extract<ConnectionHandle, { kind: K }> };

// ── Helpers ────────────────────────────────────────────────────────

const viaJson = (v?: TransportHandle): string =>
  v ? JSON.stringify({ id: v.id, kind: v.kind }) : '';

/** String key for the effect dep list: identity changes ⇒ tear-down + re-open. */
function connectionIdentity(spec: ConnectionSpec): string {
  switch (spec.kind) {
    case 'ws':        return spec.url;
    case 'tcp':       return `${spec.host}:${spec.port}`;
    case 'udp':       return `${spec.host}:${spec.port}`;
    case 'wireguard': return spec.interfaceName ?? 'wg';
    case 'tor':       return `tor:${spec.socksPort ?? 'sys'}:${spec.embedded ? 'e' : 's'}`;
    case 'socks5':    return `${spec.host}:${spec.port}`;
    case 'stun':      return spec.server;
    case 'peer':      return spec.peerId;
    case 'http':      return `${spec.method ?? 'GET'} ${spec.url}`;
    case 'sse':       return spec.url;
    case 'rcon':      return `${spec.host}:${spec.port}`;
    case 'a2s':       return `${spec.host}:${spec.port}`;
  }
}

/** Tell the host to tear down the backend channel. Idempotent. */
function closeBackend(spec: ConnectionSpec, id: number): void {
  switch (spec.kind) {
    case 'ws':     wsClose(id); return;
    case 'tcp':    tcpClose(id); return;
    case 'udp':    udpClose(id); return;
    case 'tor':    torStop(id); return;
    case 'socks5': socks5Unregister(id); return;
    case 'http':
    case 'sse':    httpStreamClose(`c${id}`); return;
    case 'rcon':   rconClose(id); return;
    case 'a2s':    a2sClose(id); return;
    // wireguard / stun / peer: no backend to tear down.
  }
}

interface BaseCtl {
  cancelled: { value: boolean };
  setState: (s: ConnectionState) => void;
  setError: (m: string | undefined) => void;
}

interface TorExtras { setTorInfo: (i: TorInfo) => void }
interface HttpExtras { setHttpStatus: (n: number) => void }
interface RconExtras { setRconAuthed: (a: boolean) => void }

type TorInfo = { socksPort: number; hostname: string; hsPort: number };

function asString(raw: unknown): string {
  return typeof raw === 'string' ? raw : String(raw);
}

// ── Typed subscribe helpers ────────────────────────────────────────
//
// Each backend channel carries one of three shapes: nothing (signal-only),
// a string (raw text payload), or a JSON object. These three helpers wrap
// `subscribe()` so wire functions never see `(raw: any)` and never repeat
// the `if (ctl.cancelled.value) return;` boilerplate.
//
// Payload shapes by channel:
//   ws:open      void                  ws:message    string
//   ws:close     WsCloseEvent          ws:error      string
//   tcp:open     void                  tcp:data      string
//   tcp:close    void                  tcp:error     string
//   udp:packet   string                udp:error     string
//   tor:open     TorOpenEvent          tor:error     string
//   http-stream  string                http-stream-end  HttpEndEvent
//   rcon:auth    RconAuthEvent         rcon:response RconResponseEvent
//   rcon:close   void                  rcon:error    string
//   a2s:info     A2sInfo               a2s:players   A2sPlayer[]
//   a2s:rules    Record<string,string> a2s:error     string

interface WsCloseEvent { code?: number; reason?: string }
interface TorOpenEvent { socksPort?: number; hostname?: string; hsPort?: number }
interface HttpEndEvent { status?: number; error?: string }
interface RconAuthEvent { ok?: boolean }
interface RconResponseEvent { requestId?: number; body?: string }

function onVoid(channel: string, ctl: BaseCtl, cb: () => void): Unsubscribe {
  return subscribe(channel, () => {
    if (ctl.cancelled.value) return;
    cb();
  });
}

function onString(channel: string, ctl: BaseCtl, cb: (s: string) => void): Unsubscribe {
  return subscribe(channel, (raw: unknown) => {
    if (ctl.cancelled.value) return;
    cb(asString(raw));
  });
}

/**
 * Subscribe to a JSON-payload channel. On parse failure, the callback is
 * invoked with `{}` cast to T — matches the prior behavior where each
 * handler defends against missing fields with `?? default`.
 */
function onJson<T>(channel: string, ctl: BaseCtl, cb: (obj: T) => void): Unsubscribe {
  return subscribe(channel, (raw: unknown) => {
    if (ctl.cancelled.value) return;
    let obj: T;
    try {
      obj = (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
    } catch {
      obj = {} as T;
    }
    cb(obj);
  });
}

// ── Per-kind wire functions ────────────────────────────────────────
//
// Each wires its backend events and returns an Unsubscribe that detaches
// all listeners. The effect's cleanup is just this returned function plus
// a `closeBackend()` call — one source for tear-down.

function wireWs(
  id: number,
  spec: WsConnectionSpec,
  getSpec: () => WsConnectionSpec,
  ctl: BaseCtl,
): Unsubscribe {
  wsOpen(id, spec.url, viaJson(spec.via));
  const unsubs: Unsubscribe[] = [
    onVoid(`ws:open:${id}`, ctl, () => {
      getSpec().onOpen?.();
      ctl.setState('open');
    }),
    onString(`ws:message:${id}`, ctl, (s) => {
      getSpec().onMessage?.(s);
    }),
    onJson<WsCloseEvent>(`ws:close:${id}`, ctl, (obj) => {
      getSpec().onClose?.({ code: obj.code ?? 0, reason: obj.reason ?? '' });
      ctl.setState('closed');
    }),
    onString(`ws:error:${id}`, ctl, (m) => {
      getSpec().onError?.(m);
      ctl.setError(m);
      ctl.setState('error');
    }),
  ];
  return () => { for (const u of unsubs) u(); };
}

function wireTcp(
  id: number,
  spec: TcpConnectionSpec,
  getSpec: () => TcpConnectionSpec,
  ctl: BaseCtl,
): Unsubscribe {
  tcpConnect(id, spec.host, spec.port, viaJson(spec.via));
  const unsubs: Unsubscribe[] = [
    onVoid(`tcp:open:${id}`, ctl, () => ctl.setState('open')),
    onString(`tcp:data:${id}`, ctl, (s) => getSpec().onData?.(s)),
    onVoid(`tcp:close:${id}`, ctl, () => {
      getSpec().onClose?.();
      ctl.setState('closed');
    }),
    onString(`tcp:error:${id}`, ctl, (m) => {
      getSpec().onError?.(m);
      ctl.setError(m);
      ctl.setState('error');
    }),
  ];
  // tcp_connect is sync today; flip to open optimistically if no event arrives.
  ctl.setState('open');
  return () => { for (const u of unsubs) u(); };
}

function wireUdp(
  id: number,
  spec: UdpConnectionSpec,
  getSpec: () => UdpConnectionSpec,
  ctl: BaseCtl,
): Unsubscribe {
  udpOpen(id, spec.host, spec.port, viaJson(spec.via));
  const unsubs: Unsubscribe[] = [
    onString(`udp:packet:${id}`, ctl, (s) => getSpec().onPacket?.(s)),
    onString(`udp:error:${id}`, ctl, (m) => {
      getSpec().onError?.(m);
      ctl.setError(m);
      ctl.setState('error');
    }),
  ];
  ctl.setState('open');
  return () => { for (const u of unsubs) u(); };
}

function wireTor(
  id: number,
  spec: TorConnectionSpec,
  _getSpec: () => TorConnectionSpec,
  ctl: BaseCtl & TorExtras,
): Unsubscribe {
  const opts = JSON.stringify({
    identity: spec.socksPort ? '' : 'default',
    socksPort: spec.socksPort ?? 0,
  });
  torStart(id, opts);
  const unsubs: Unsubscribe[] = [
    onJson<TorOpenEvent>(`tor:open:${id}`, ctl, (obj) => {
      if (typeof obj.socksPort === 'number' && typeof obj.hostname === 'string' && typeof obj.hsPort === 'number') {
        ctl.setTorInfo({ socksPort: obj.socksPort, hostname: obj.hostname, hsPort: obj.hsPort });
      }
      ctl.setState('open');
    }),
    onString(`tor:error:${id}`, ctl, (m) => {
      ctl.setError(m);
      ctl.setState('error');
    }),
  ];
  return () => { for (const u of unsubs) u(); };
}

function wireSocks5(
  id: number,
  spec: Socks5ConnectionSpec,
  _getSpec: () => Socks5ConnectionSpec,
  ctl: BaseCtl,
): Unsubscribe {
  socks5Register(id, spec.host, spec.port, spec.username ?? '', spec.password ?? '');
  // SOCKS5 is a config holder — no socket opens here. The proxy is used
  // when another connection passes this handle as `via:`.
  ctl.setState('open');
  return () => {};
}

function wireHttpOrSse(
  id: number,
  spec: HttpConnectionSpec | SseConnectionSpec,
  getSpec: () => HttpConnectionSpec | SseConnectionSpec,
  ctl: BaseCtl & HttpExtras,
): Unsubscribe {
  const rid = `c${id}`;
  const isSse = spec.kind === 'sse';
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  if (isSse) {
    headers['Accept'] = 'text/event-stream';
    if (!('Cache-Control' in headers)) headers['Cache-Control'] = 'no-cache';
  }
  const explicitMethod = spec.kind === 'http' ? spec.method : undefined;
  const body = spec.body;
  const method = (explicitMethod ?? (body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const reqJson = JSON.stringify({ method, url: spec.url, headers, body });

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
    (getSpec() as SseConnectionSpec).onEvent?.(ev);
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
  ctl.setState('open');
  if (isSse) (getSpec() as SseConnectionSpec).onOpen?.();

  const unsubs: Unsubscribe[] = [
    onString(`http-stream:${rid}`, ctl, (s) => {
      if (isSse) feedSse(s);
      else (getSpec() as HttpConnectionSpec).onChunk?.(s);
    }),
    onJson<HttpEndEvent>(`http-stream-end:${rid}`, ctl, (obj) => {
      const cur = getSpec();
      if (typeof obj.error === 'string') {
        cur.onError?.(obj.error);
        ctl.setError(obj.error);
        ctl.setState('error');
      } else {
        if (isSse && leftover !== '') { feedSse('\n'); } // flush trailing
        const status = obj.status ?? 0;
        if (typeof obj.status === 'number') ctl.setHttpStatus(obj.status);
        if (cur.kind === 'sse') cur.onClose?.();
        else cur.onComplete?.({ status });
        ctl.setState('closed');
      }
    }),
  ];
  return () => { for (const u of unsubs) u(); };
}

function wireRcon(
  id: number,
  spec: RconConnectionSpec,
  getSpec: () => RconConnectionSpec,
  ctl: BaseCtl & RconExtras,
): Unsubscribe {
  rconOpen(id, spec.host, spec.port, spec.password);
  // The Zig side already framed and sent the AUTH packet. We optimistically
  // mark connecting → 'open' (TCP up, awaiting AUTH_RESPONSE); 'authed'
  // is tracked separately on the handle.
  ctl.setState('open');
  const unsubs: Unsubscribe[] = [
    onJson<RconAuthEvent>(`rcon:auth:${id}`, ctl, (obj) => {
      const ok = !!obj.ok;
      ctl.setRconAuthed(ok);
      getSpec().onAuth?.(ok);
      if (!ok) ctl.setState('error');
    }),
    onJson<RconResponseEvent>(`rcon:response:${id}`, ctl, (obj) => {
      getSpec().onResponse?.({
        requestId: obj.requestId ?? 0,
        body: obj.body ?? '',
      });
    }),
    onVoid(`rcon:close:${id}`, ctl, () => {
      getSpec().onClose?.();
      ctl.setState('closed');
    }),
    onString(`rcon:error:${id}`, ctl, (m) => {
      getSpec().onError?.(m);
      ctl.setError(m);
      ctl.setState('error');
    }),
  ];
  return () => { for (const u of unsubs) u(); };
}

function wireA2s(
  id: number,
  spec: A2sConnectionSpec,
  getSpec: () => A2sConnectionSpec,
  ctl: BaseCtl,
): Unsubscribe {
  a2sOpen(id, spec.host, spec.port);
  ctl.setState('open');
  const unsubs: Unsubscribe[] = [
    onJson<A2sInfo>(`a2s:info:${id}`, ctl, (info) => getSpec().onInfo?.(info)),
    onJson<A2sPlayer[]>(`a2s:players:${id}`, ctl, (players) => getSpec().onPlayers?.(players)),
    onJson<Record<string, string>>(`a2s:rules:${id}`, ctl, (rules) => getSpec().onRules?.(rules)),
    onString(`a2s:error:${id}`, ctl, (m) => {
      getSpec().onError?.(m);
      ctl.setError(m);
      ctl.setState('error');
    }),
  ];
  return () => { for (const u of unsubs) u(); };
}

// ── Hook ───────────────────────────────────────────────────────────

export function useConnection<K extends ConnectionKind>(spec: SpecByKind[K]): HandleByKind[K] {
  return useConnectionImpl(spec) as HandleByKind[K];
}

function useConnectionImpl(spec: ConnectionSpec): ConnectionHandle {
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = nextId();
  const id = idRef.current;

  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | undefined>(undefined);
  // Tor only — populated when bootstrap completes.
  const [torInfo, setTorInfo] = useState<TorInfo | undefined>(undefined);
  // http only — populated on .complete from http-stream-end.
  const [httpStatus, setHttpStatus] = useState<number>(0);
  // rcon only — flips on AUTH_RESPONSE.
  const [rconAuthed, setRconAuthed] = useState<boolean>(false);
  const rconReqSeq = useRef<number>(1);

  const specRef = useLatest(spec);
  const getSpec = <T extends ConnectionSpec>() => specRef.current as T;

  const identity = connectionIdentity(spec);
  const viaKey = spec.via ? `${spec.via.kind}:${spec.via.id}` : '';

  useEffect(() => {
    const cancelled = { value: false };
    const ctl: BaseCtl = { cancelled, setState, setError };

    let detach: Unsubscribe;
    switch (spec.kind) {
      case 'ws':
        detach = wireWs(id, spec, getSpec, ctl);
        break;
      case 'tcp':
        detach = wireTcp(id, spec, getSpec, ctl);
        break;
      case 'udp':
        detach = wireUdp(id, spec, getSpec, ctl);
        break;
      case 'tor':
        detach = wireTor(id, spec, getSpec, { ...ctl, setTorInfo });
        break;
      case 'socks5':
        detach = wireSocks5(id, spec, getSpec, ctl);
        break;
      case 'http':
      case 'sse':
        detach = wireHttpOrSse(id, spec, getSpec, { ...ctl, setHttpStatus });
        break;
      case 'rcon':
        detach = wireRcon(id, spec, getSpec, { ...ctl, setRconAuthed });
        break;
      case 'a2s':
        detach = wireA2s(id, spec, getSpec, ctl);
        break;
      default:
        // wireguard / stun / peer: no Zig backend yet. Honest error rather
        // than a silent open. When the binding lands, add a wireX driver.
        setError(`${spec.kind} transport: zig backend not yet implemented`);
        setState('error');
        detach = () => {};
    }

    return () => {
      cancelled.value = true;
      detach();
      closeBackend(spec, id);
      setState('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.kind, identity, viaKey]);

  const close = () => closeBackend(spec, id);

  switch (spec.kind) {
    case 'ws':
      return { kind: 'ws', id, state, error, close, send: (data) => wsSend(id, data) };
    case 'tcp':
      return { kind: 'tcp', id, state, error, close, send: (data) => tcpSend(id, data) };
    case 'udp':
      return { kind: 'udp', id, state, error, close, send: (data) => udpSend(id, data) };
    case 'wireguard':
      return { kind: 'wireguard', id, state, error, close };
    case 'tor':
      return {
        kind: 'tor', id, state, error, close,
        socksPort: torInfo?.socksPort ?? spec.socksPort ?? 0,
        hostname: torInfo?.hostname,
        hsPort: torInfo?.hsPort ?? 0,
      };
    case 'socks5':
      return { kind: 'socks5', id, state, error, close };
    case 'stun':
      return { kind: 'stun', id, state, error, close };
    case 'http':
      return { kind: 'http', id, state, error, close, status: httpStatus };
    case 'sse':
      return { kind: 'sse', id, state, error, close };
    case 'rcon':
      return {
        kind: 'rcon', id, state, error, close,
        authenticated: rconAuthed,
        command: (cmd: string) => {
          const reqId = rconReqSeq.current++;
          rconCommand(id, reqId, cmd);
          return reqId;
        },
      };
    case 'a2s':
      return {
        kind: 'a2s', id, state, error, close,
        queryInfo: () => a2sQuery(id, 'info'),
        queryPlayers: () => a2sQuery(id, 'players'),
        queryRules: () => a2sQuery(id, 'rules'),
      };
    case 'peer':
      return {
        kind: 'peer', id, state, error, close,
        send: (_data: string) => { /* not wired */ },
      };
  }
}
