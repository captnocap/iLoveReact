/**
 * fetch — standards-shaped HTTP wrappers (Tier 1).
 *
 * Built on useTheInternet. Offers enough Fetch API surface that copy-pasted
 * browser code using fetch() / EventSource works, plus convenience async
 * helpers (getAsync, postAsync, download, etc.).
 */

import {
  httpRequestAsync,
  httpStreamOpen,
  httpStreamClose,
  httpDownloadToFile,
  nextReqId,
  subscribe,
} from './useTheInternet';

// ── Standards-shaped fetch ─────────────────────────────────────────

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (k: string) => string | null };
  text: () => Promise<string>;
  json: () => Promise<any>;
  blob: () => Promise<any>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export async function fetch(url: string, init: FetchInit = {}): Promise<FetchResponse> {
  const reqJson = JSON.stringify({
    method: (init.method || 'GET').toUpperCase(),
    url,
    headers: init.headers ?? {},
    body: init.body,
  });
  const reqId = nextReqId();
  return new Promise<FetchResponse>((resolve) => {
    const unsub = subscribe(`http:${reqId}`, (payload) => {
      unsub();
      const r = typeof payload === 'string' ? JSON.parse(payload) : payload;
      resolve({
        ok: (r.status ?? 0) >= 200 && (r.status ?? 0) < 300,
        status: r.status ?? 0,
        statusText: '',
        headers: { get: (k: string) => (r.headers ?? {})[k.toLowerCase()] ?? null },
        text: async () => r.body ?? '',
        json: async () => JSON.parse(r.body ?? '{}'),
        blob: async () => { throw new Error('fetch: blob() not supported'); },
        arrayBuffer: async () => { throw new Error('fetch: arrayBuffer() not supported'); },
      });
    });
    httpRequestAsync(reqJson, reqId);
  });
}

// ── Convenience async helpers ──────────────────────────────────────

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

export function requestAsync(req: HttpRequest): Promise<HttpResponse> {
  const reqId = nextReqId();
  return new Promise<HttpResponse>((resolve) => {
    const unsub = subscribe(`http:${reqId}`, (payload) => {
      unsub();
      resolve(typeof payload === 'string' ? JSON.parse(payload) : payload);
    });
    httpRequestAsync(JSON.stringify(req), reqId);
  });
}

export function getAsync(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
  return requestAsync({ method: 'GET', url, headers });
}

export function postAsync(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
  return requestAsync({ method: 'POST', url, body, headers });
}

// ── Streaming download ─────────────────────────────────────────────

export interface StreamingHttpRequest extends HttpRequest {}

export interface StreamingHttpHandle {
  close(): void;
}

export interface StreamingHttpCallbacks {
  onChunk?: (data: string) => void;
  onComplete?: (info: { status: number }) => void;
  onError?: (msg: string) => void;
}

export function requestStream(req: StreamingHttpRequest, cb: StreamingHttpCallbacks): StreamingHttpHandle {
  const rid = nextReqId();
  const unsubChunk = subscribe(`http-stream:${rid}`, (data) => {
    const s = typeof data === 'string' ? data : String(data);
    cb.onChunk?.(s);
  });
  const unsubEnd = subscribe(`http-stream-end:${rid}`, (raw) => {
    let obj: any = {};
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
    unsubChunk();
    unsubEnd();
    if (typeof obj.error === 'string') cb.onError?.(obj.error);
    else cb.onComplete?.({ status: obj.status ?? 0 });
  });
  httpStreamOpen(JSON.stringify(req), rid);
  return {
    close: () => {
      unsubChunk();
      unsubEnd();
      httpStreamClose(rid);
    },
  };
}

// ── download() — stream a binary response straight to a file ──────

export interface DownloadProgress {
  bytes: number;
  total: number;
}

export interface DownloadOptions {
  url: string;
  destPath: string;
  headers?: Record<string, string>;
  onProgress?: (p: DownloadProgress) => void;
}

export function download(opts: DownloadOptions): Promise<{ status: number }> {
  return new Promise<{ status: number }>((resolve, reject) => {
    const rid = nextReqId();
    const unsubProgress = subscribe(`http-download-progress:${rid}`, (raw) => {
      if (!opts.onProgress) return;
      try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        opts.onProgress({ bytes: Number(obj.d) || 0, total: Number(obj.t) || 0 });
      } catch { /* swallow */ }
    });
    const unsubEnd = subscribe(`http-download-end:${rid}`, (raw) => {
      unsubProgress();
      unsubEnd();
      let obj: any = {};
      try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
      if (typeof obj.error === 'string') {
        reject(new Error(obj.error));
        return;
      }
      const status = Number(obj.status) || 0;
      if (status < 200 || status >= 300) {
        reject(new Error(`HTTP ${status}`));
        return;
      }
      resolve({ status });
    });
    const spec = JSON.stringify({
      method: 'GET',
      url: opts.url,
      headers: opts.headers ?? {},
    });
    httpDownloadToFile(spec, opts.destPath, rid);
  });
}

// ── EventSource shim ───────────────────────────────────────────────

type EsHandler = (ev: any) => void;

class ReactjitEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readyState: number = ReactjitEventSource.CONNECTING;
  onopen: EsHandler | null = null;
  onmessage: EsHandler | null = null;
  onerror: EsHandler | null = null;

  private _rid: string | null = null;
  private _named: Map<string, Set<EsHandler>> = new Map();
  private _leftover: string = '';
  private _evName: string = 'message';
  private _evData: string = '';
  private _evId: string | undefined;
  private _unsubs: Array<() => void> = [];

  constructor(url: string, _init?: { withCredentials?: boolean }) {
    this.url = url;
    const rid = `es${nextReqId()}`;
    this._rid = rid;

    const reqJson = JSON.stringify({
      method: 'GET',
      url,
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    });

    const unsubChunk = subscribe(`http-stream:${rid}`, (data) => {
      const s = typeof data === 'string' ? data : String(data);
      if (this.readyState === ReactjitEventSource.CONNECTING) {
        this.readyState = ReactjitEventSource.OPEN;
        this.onopen?.({ type: 'open' });
      }
      this._feed(s);
    });
    const unsubEnd = subscribe(`http-stream-end:${rid}`, (raw) => {
      let obj: any = {};
      try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
      unsubChunk();
      unsubEnd();
      this._unsubs = this._unsubs.filter((u) => u !== unsubChunk && u !== unsubEnd);
      if (typeof obj.error === 'string') {
        this.readyState = ReactjitEventSource.CLOSED;
        this.onerror?.({ type: 'error', message: obj.error });
      } else {
        if (this._leftover !== '') this._feed('\n');
        this.readyState = ReactjitEventSource.CLOSED;
      }
    });
    this._unsubs.push(unsubChunk, unsubEnd);
    httpStreamOpen(reqJson, rid);
  }

  addEventListener(name: string, handler: EsHandler): void {
    let set = this._named.get(name);
    if (!set) { set = new Set(); this._named.set(name, set); }
    set.add(handler);
  }

  removeEventListener(name: string, handler: EsHandler): void {
    this._named.get(name)?.delete(handler);
  }

  close(): void {
    this.readyState = ReactjitEventSource.CLOSED;
    for (const u of this._unsubs) u();
    this._unsubs = [];
    if (this._rid) httpStreamClose(this._rid);
    this._rid = null;
  }

  private _feed(incoming: string): void {
    const buf = this._leftover + incoming;
    const lines = buf.split(/\r\n|\r|\n/);
    this._leftover = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') { this._dispatch(); continue; }
      if (line.startsWith(':')) continue;
      const sep = line.indexOf(':');
      const field = sep === -1 ? line : line.slice(0, sep);
      let value = sep === -1 ? '' : line.slice(sep + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this._evName = value;
      else if (field === 'data') this._evData = this._evData === '' ? value : `${this._evData}\n${value}`;
      else if (field === 'id') this._evId = value;
    }
  }

  private _dispatch(): void {
    if (this._evData === '' && this._evName === 'message') {
      this._evName = 'message';
      this._evData = '';
      this._evId = undefined;
      return;
    }
    const ev: any = { type: this._evName, data: this._evData, lastEventId: this._evId ?? '' };
    if (this._evName === 'message') this.onmessage?.(ev);
    const named = this._named.get(this._evName);
    if (named) for (const h of named) h(ev);
    this._evName = 'message';
    this._evData = '';
    this._evId = undefined;
  }
}

export function installFetchShim(): void {
  (globalThis as any).fetch = fetch;
}

export function installEventSourceShim(): void {
  (globalThis as any).EventSource = ReactjitEventSource;
}
