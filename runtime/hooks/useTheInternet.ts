/**
 * useTheInternet — the single door for all native networking deps.
 *
 * Nothing sends or receives packets except through here. This is the only
 * file that calls callHost / subscribe for HTTP, WS, TCP, UDP, Tor, SOCKS5,
 * RCON, A2S, browser page fetch, and browse bridge operations.
 *
 * Tier 0. Everything else wraps this.
 */

import { callHost, subscribe } from '../ffi';

// ── ID sequencing ──────────────────────────────────────────────────

let _idSeq = 1;
let _reqIdSeq = 1;
let _streamSeq = 1;
let _dlSeq = 1;
let _browseSeq = 1;
let _pageSeq = 1;

export const nextId = () => _idSeq++;
export const nextReqId = () => `req${_reqIdSeq++}`;
export const nextStreamId = () => `s${_streamSeq++}`;
export const nextDownloadId = () => `d${_dlSeq++}`;
export const nextBrowseId = () => `b${_browseSeq++}`;
export const nextPageId = () => `page${_pageSeq++}`;

// ── HTTP outbound ──────────────────────────────────────────────────

export function httpRequestSync(reqJson: string): string {
  return callHost<string>(
    '__http_request_sync',
    '{"status":0,"headers":{},"body":"","error":"http not wired"}',
    reqJson,
  );
}

export function httpRequestAsync(reqJson: string, reqId: string): void {
  callHost<void>('__http_request_async', undefined as any, reqJson, reqId);
}

export function httpStreamOpen(reqJson: string, rid: string): void {
  callHost<void>('__http_stream_open', undefined as any, reqJson, rid);
}

export function httpStreamClose(rid: string): void {
  callHost<void>('__http_stream_close', undefined as any, rid);
}

export function httpDownloadToFile(spec: string, destPath: string, rid: string): void {
  callHost<void>('__http_download_to_file', undefined as any, spec, destPath, rid);
}

// ── HTTP inbound (host) ────────────────────────────────────────────

export function httpSrvListen(id: number, port: number, routesJson: string, via: string): number {
  return callHost<number>('__httpsrv_listen', 0, id, port, routesJson, via);
}

export function httpSrvRespond(
  id: number,
  clientId: number,
  status: number,
  contentType: string,
  body: string,
): void {
  callHost<void>('__httpsrv_respond', undefined as any, id, clientId, status, contentType, body);
}

export function httpSrvClose(id: number): void {
  callHost<void>('__httpsrv_close', undefined as any, id);
}

// ── WS inbound (host) ──────────────────────────────────────────────

export function wsSrvListen(id: number, port: number, via: string): void {
  callHost<void>('__wssrv_listen', undefined as any, id, port, via);
}

export function wsSrvSend(id: number, clientId: number, data: string): void {
  callHost<void>('__wssrv_send', undefined as any, id, clientId, data);
}

export function wsSrvBroadcast(id: number, data: string): void {
  callHost<void>('__wssrv_broadcast', undefined as any, id, data);
}

export function wsSrvClose(id: number): void {
  callHost<void>('__wssrv_close', undefined as any, id);
}

// ── WS outbound ────────────────────────────────────────────────────

export function wsOpen(id: number, url: string, via: string): void {
  callHost<void>('__ws_open', undefined as any, id, url, via);
}

export function wsSend(id: number, data: string): void {
  callHost<void>('__ws_send', undefined as any, id, data);
}

export function wsClose(id: number): void {
  callHost<void>('__ws_close', undefined as any, id);
}

// ── TCP ────────────────────────────────────────────────────────────

export function tcpConnect(id: number, host: string, port: number, via: string): void {
  callHost<void>('__tcp_connect', undefined as any, id, host, port, via);
}

export function tcpSend(id: number, data: string): void {
  callHost<void>('__tcp_send', undefined as any, id, data);
}

export function tcpClose(id: number): void {
  callHost<void>('__tcp_close', undefined as any, id);
}

// ── UDP ────────────────────────────────────────────────────────────

export function udpOpen(id: number, host: string, port: number, via: string): void {
  callHost<void>('__udp_open', undefined as any, id, host, port, via);
}

export function udpSend(id: number, data: string): void {
  callHost<void>('__udp_send', undefined as any, id, data);
}

export function udpClose(id: number): void {
  callHost<void>('__udp_close', undefined as any, id);
}

// ── Tor ────────────────────────────────────────────────────────────

export function torStart(id: number, opts: string): void {
  callHost<void>('__tor_start', undefined as any, id, opts);
}

export function torStop(id: number): void {
  callHost<void>('__tor_stop', undefined as any, id);
}

// ── SOCKS5 ─────────────────────────────────────────────────────────

export function socks5Register(
  id: number,
  host: string,
  port: number,
  username: string,
  password: string,
): void {
  callHost<void>('__socks5_register', undefined as any, id, host, port, username, password);
}

export function socks5Unregister(id: number): void {
  callHost<void>('__socks5_unregister', undefined as any, id);
}

// ── RCON ───────────────────────────────────────────────────────────

export function rconOpen(id: number, host: string, port: number, password: string): void {
  callHost<void>('__rcon_open', undefined as any, id, host, port, password);
}

export function rconClose(id: number): void {
  callHost<void>('__rcon_close', undefined as any, id);
}

export function rconCommand(id: number, reqId: number, cmd: string): void {
  callHost<void>('__rcon_command', undefined as any, id, reqId, cmd);
}

// ── A2S ────────────────────────────────────────────────────────────

export function a2sOpen(id: number, host: string, port: number): void {
  callHost<void>('__a2s_open', undefined as any, id, host, port);
}

export function a2sClose(id: number): void {
  callHost<void>('__a2s_close', undefined as any, id);
}

export function a2sQuery(id: number, kind: string): void {
  callHost<void>('__a2s_query', undefined as any, id, kind);
}

// ── Browser page fetch ─────────────────────────────────────────────
// Backed by framework/net/page_fetch.zig (HTTP/1.1 + tls.zig worker pool).
// This path will absorb nghttp2 as the stack matures.

export function browserPageSync(spec: string): string {
  return callHost<string>(
    '__browser_page_sync',
    '{"status":0,"finalUrl":"","contentType":"","body":"","error":"browser page not wired"}',
    spec,
  );
}

export function browserPageAsync(spec: string, reqId: string): void {
  callHost<void>('__browser_page_async', undefined as any, spec, reqId);
}

// ── Browse bridge ──────────────────────────────────────────────────
// TCP bridge to the `browse` Python session (127.0.0.1:7331).
// Newline-delimited JSON request/response over short-lived connections.

export function browseRequestAsync(body: string, reqId: string): void {
  callHost<void>('__browse_request_async', undefined as any, body, reqId);
}

export function browseSetPort(port: number): void {
  callHost<void>('__browse_set_port', undefined as any, port);
}

// ── Re-export subscribe so tier-1 wrappers can pull events ─────────
export { subscribe } from '../ffi';
