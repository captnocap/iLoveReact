/**
 * useBrowse — drive a stealth `browse` Firefox session from a cart.
 *
 * `browse` (https://github.com/captnocap/browse) runs a Selenium-controlled
 * Firefox with native RFP anti-fingerprinting and exposes a JSON-line TCP
 * server on 127.0.0.1:7331. This hook bridges via the framework's
 * __browse_request_async host call (framework/net/browse_bridge.zig).
 *
 * Two operating shapes:
 *
 * 1. Connect to a session the user already started in their terminal:
 *      const b = useBrowse();           // defaults to port 7331
 *      await b.navigate('https://...');
 *
 * 2. Spawn a private session in-cart via <Render renderSrc="app:browse --port 7332" />
 *    and point the hook at it:
 *      const b = useBrowse({ port: 7332 });
 *
 * The second shape is what the MVP cart uses — the embedded Firefox window
 * is painted into a <Render> surface so the user can watch the agent drive
 * the browser live in the chat.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { hasHost } from '../ffi';
import { browseRequestAsync, browseSetPort, nextBrowseId, subscribe } from './useTheInternet';



interface Envelope {
  ok: boolean;
  result?: any;
  error?: string;
}

export interface BrowseOptions {
  /** TCP port of the browse session. Default 7331 (matches `browse` default). */
  port?: number;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
  links: { text: string; href: string }[];
  forms: any[];
  meta?: Record<string, string>;
}

export interface BrowseHandle {
  navigate: (url: string) => Promise<PageContent>;
  click: (selector: string) => Promise<boolean>;
  typeText: (selector: string, text: string) => Promise<boolean>;
  extractContent: () => Promise<PageContent>;
  screenshot: () => Promise<{ png_b64: string }>;
  back: () => Promise<boolean>;
  forward: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
  executeJs: (script: string) => Promise<any>;
  listTabs: () => Promise<{ tabs: { index: number; title: string; url: string; active: boolean }[] }>;
  useTab: (index: number) => Promise<{ index: number; title: string; url: string }>;
  openTab: (url: string) => Promise<any>;
  ping: () => Promise<boolean>;
  raw: (cmd: Record<string, any>) => Promise<any>;
  loading: boolean;
  error: Error | null;
  /** Result of the most recent successful call. */
  last: any;
}

/**
 * Send a single browse command synchronously through the host bridge. Used
 * internally by the hook and as a standalone callable for tool-execution
 * paths that don't have a React component.
 */
export async function browseRequest(cmd: Record<string, any>): Promise<any> {
  if (!hasHost('__browse_request_async')) {
    throw new Error('browse host bindings not registered (framework/net/browse_bridge.zig)');
  }
  const reqId = nextBrowseId();
  const body = JSON.stringify(cmd);
  return new Promise<any>((resolve, reject) => {
    const unsub = subscribe(`browse:${reqId}`, (payload: any) => {
      unsub();
      let env: Envelope;
      try {
        env = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch (e: any) {
        reject(new Error(`browse: malformed reply: ${e?.message || e}`));
        return;
      }
      if (!env.ok) reject(new Error(env.error || 'browse error'));
      else resolve(env.result);
    });
    browseRequestAsync(body, reqId);
  });
}

/** Fire-and-forget port set. Affects all browse calls process-wide. */
export function setBrowsePort(port: number): void {
  browseSetPort(port);
}

export function useBrowse(options: BrowseOptions = {}): BrowseHandle {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const lastRef = useRef<any>(null);
  const [, force] = useState(0);

  // Apply port on mount and whenever it changes. Process-wide global —
  // multiple useBrowse callers using different ports will collide; for MVP
  // we accept that.
  useEffect(() => {
    if (typeof options.port === 'number' && options.port > 0) {
      setBrowsePort(options.port);
    }
  }, [options.port]);

  const exec = useCallback(async (cmd: Record<string, any>) => {
    setLoading(true);
    setError(null);
    try {
      const r = await browseRequest(cmd);
      lastRef.current = r;
      force((n) => n + 1);
      return r;
    } catch (e: any) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const navigate = useCallback((url: string) => exec({ cmd: 'navigate', url }), [exec]);
  const click = useCallback((selector: string) => exec({ cmd: 'click', selector }), [exec]);
  const typeText = useCallback(
    (selector: string, text: string) => exec({ cmd: 'type_text', selector, text }),
    [exec],
  );
  const extractContent = useCallback(() => exec({ cmd: 'extract_content' }), [exec]);
  const screenshot = useCallback(() => exec({ cmd: 'screenshot' }), [exec]);
  const back = useCallback(() => exec({ cmd: 'back' }), [exec]);
  const forward = useCallback(() => exec({ cmd: 'forward' }), [exec]);
  const refresh = useCallback(() => exec({ cmd: 'refresh' }), [exec]);
  const executeJs = useCallback((script: string) => exec({ cmd: 'execute_js', script }), [exec]);
  const listTabs = useCallback(() => exec({ cmd: 'list_tabs' }), [exec]);
  const useTab = useCallback((index: number) => exec({ cmd: 'use_tab', index }), [exec]);
  const openTab = useCallback((url: string) => exec({ cmd: 'open_tab', url }), [exec]);
  const ping = useCallback(async () => {
    try {
      await exec({ cmd: 'ping' });
      return true;
    } catch {
      return false;
    }
  }, [exec]);
  const raw = useCallback((cmd: Record<string, any>) => exec(cmd), [exec]);

  return {
    navigate,
    click,
    typeText,
    extractContent,
    screenshot,
    back,
    forward,
    refresh,
    executeJs,
    listTabs,
    useTab,
    openTab,
    ping,
    raw,
    loading,
    error,
    last: lastRef.current,
  };
}

// ── AI tool definitions ─────────────────────────────────────────────
//
// Shape mirrors love2d/packages/ai's ToolDefinition. Drop the result of
// createBrowseTools() into useLocalChat({ tools: [...] }) (once tool-calling
// lands there) to give a local-llama agent the browser as a tool.

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, any>; required?: string[] };
  execute: (args: any) => Promise<any>;
}

export function createBrowseTools(_options: BrowseOptions = {}): ToolDefinition[] {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate the browser to a URL. Returns extracted page text, links, forms.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The URL to load.' } },
        required: ['url'],
      },
      execute: async ({ url }: { url: string }) => formatPage(await browseRequest({ cmd: 'navigate', url })),
    },
    {
      name: 'browser_click',
      description: 'Click an element by CSS selector. Returns updated page content.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string' } },
        required: ['selector'],
      },
      execute: async ({ selector }: { selector: string }) => browseRequest({ cmd: 'click', selector }),
    },
    {
      name: 'browser_type',
      description: 'Type text into an input by CSS selector. Does NOT submit — call browser_click on the submit button after.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string' }, text: { type: 'string' } },
        required: ['selector', 'text'],
      },
      execute: async ({ selector, text }: { selector: string; text: string }) =>
        browseRequest({ cmd: 'type_text', selector, text }),
    },
    {
      name: 'browser_extract',
      description: 'Re-extract the current page content. Use after AJAX/dynamic updates.',
      parameters: { type: 'object', properties: {} },
      execute: async () => formatPage(await browseRequest({ cmd: 'extract_content' })),
    },
    {
      name: 'browser_back',
      description: 'Go back in browser history.',
      parameters: { type: 'object', properties: {} },
      execute: async () => browseRequest({ cmd: 'back' }),
    },
    {
      name: 'browser_tabs',
      description: 'List all open tabs (index, title, url).',
      parameters: { type: 'object', properties: {} },
      execute: async () => browseRequest({ cmd: 'list_tabs' }),
    },
    {
      name: 'browser_use_tab',
      description: 'Switch to a tab by index (0-based). Call browser_tabs first.',
      parameters: {
        type: 'object',
        properties: { index: { type: 'number' } },
        required: ['index'],
      },
      execute: async ({ index }: { index: number }) => browseRequest({ cmd: 'use_tab', index }),
    },
    {
      name: 'browser_execute_js',
      description: 'Run a JS script in the page context. Returns the script result.',
      parameters: {
        type: 'object',
        properties: { script: { type: 'string' } },
        required: ['script'],
      },
      execute: async ({ script }: { script: string }) => browseRequest({ cmd: 'execute_js', script }),
    },
  ];
}

function formatPage(r: any): any {
  if (!r) return r;
  const out: any = { url: r.url, title: r.title };
  if (typeof r.text === 'string') {
    const max = 8000;
    out.text = r.text.length > max ? r.text.slice(0, max) + '\n... [truncated]' : r.text;
  }
  if (Array.isArray(r.links) && r.links.length > 0) {
    out.links = r.links.slice(0, 50);
    if (r.links.length > 50) out.links_truncated = `${r.links.length - 50} more`;
  }
  if (Array.isArray(r.forms) && r.forms.length > 0) out.forms = r.forms;
  return out;
}


