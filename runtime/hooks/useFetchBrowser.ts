/**
 * useFetchBrowser — fetch a web page through the browser-capable HTTP stack.
 *
 * Tier 2. Wraps useTheInternet.browserPageSync/Async.
 *
 * This path will absorb nghttp2 + tls.zig as the stack matures. Today it
 * bridges through framework/net/http.zig (std.http.Client + tls.zig).
 */

import { browserPageSync, browserPageAsync, nextPageId, subscribe } from './useTheInternet';

export interface BrowserPageResponse {
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
  truncated?: boolean;
  error?: string;
}

export async function fetchPageAsync(url: string): Promise<BrowserPageResponse> {
  const sync = browserPageSync(JSON.stringify({ url }));
  if (sync && sync.startsWith('{')) {
    try {
      const parsed = JSON.parse(sync);
      if (parsed.status && parsed.status > 0) return parsed as BrowserPageResponse;
    } catch { /* fall through to async */ }
  }

  const reqId = nextPageId();
  return new Promise<BrowserPageResponse>((resolve) => {
    const unsub = subscribe(`browser-page:${reqId}`, (payload) => {
      unsub();
      resolve(typeof payload === 'string' ? JSON.parse(payload) : payload);
    });
    browserPageAsync(JSON.stringify({ url }), reqId);
  });
}
