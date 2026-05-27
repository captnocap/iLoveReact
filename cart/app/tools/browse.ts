// Assistant tools wrapping the stealth-Firefox `browse` session.
//
// Carts that want the assistant to research the web mount the browse
// session lifecycle themselves (typical shape: spawn the session via
// `useProcess(['python', '-m', 'browse.session', '--port', '7332'])`,
// then `useBrowse({ port: 7332 })`; optionally paint the Firefox window
// into a <Render renderSrc=...> surface). These tools are the bridge
// the model sees — every call lands on the same TCP server.
//
// Permission scopes:
//   - browse-navigate / browse-open-tab    → URL host (so users can grant
//                                            "github.com" or "*")
//   - browse-execute-js                    → "*" (powerful — gate broadly)
//   - everything else (DOM ops, tabs, ...) → "*"
//
// We deliberately do NOT expose add_cookie (privileged state mutation)
// or page_source (often megabytes). Use browse-extract for page content
// — it's already filtered + truncated by the session server, and we
// truncate again here as a defense-in-depth.

import { browseRequest } from '@reactjit/runtime/hooks/useBrowse';
import { busEmit } from '@reactjit/runtime/hooks/useIFTTT';
import { register } from './registry';
import type { Tool } from './types';

function hostOf(url: unknown): string {
  if (typeof url !== 'string') return '*';
  try { return new URL(url).host || '*'; } catch { return '*'; }
}

// Every browse tool call emits a `browse:activity` IFTTT event. The
// chat route subscribes and surfaces the live Firefox window when
// activity is recent. Summary is a short label (tool name + key arg)
// so the panel can show "browse-navigate github.com" inline.
async function runBrowse(tool: string, summary: string, cmd: Record<string, any>): Promise<any> {
  busEmit('browse:activity', { tool, summary, phase: 'start', at: Date.now() });
  try {
    const result = await browseRequest(cmd);
    busEmit('browse:activity', { tool, summary, phase: 'end', at: Date.now() });
    return result;
  } catch (e: any) {
    busEmit('browse:activity', { tool, summary, phase: 'error', error: e?.message ?? String(e), at: Date.now() });
    throw e;
  }
}

// browse.session already returns trimmed page content, but a runaway
// page can still produce a huge text blob. Cap before it reaches the
// model's context.
function formatPage(r: any): any {
  if (!r || typeof r !== 'object') return r;
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
  if (r.challenge) out.challenge = r.challenge;
  return out;
}

// ── navigation ────────────────────────────────────────────────────────

const navigate: Tool<{ url: string }, any> = {
  name: 'browse-navigate',
  description: 'Load a URL in the stealth browser. Returns extracted page text, links, and forms. If the page hit a CAPTCHA/cloudflare wall the result includes `challenge`.',
  argsSchema: '{ url: string }',
  scopeOf: (args) => hostOf(args?.url),
  handler: async ({ url }) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error('browse-navigate: url must be an absolute http(s) URL');
    }
    return formatPage(await runBrowse('browse-navigate', hostOf(url), { cmd: 'navigate', url }));
  },
};

const extract: Tool<Record<string, never>, any> = {
  name: 'browse-extract',
  description: 'Re-extract the currently displayed page. Use after JS-driven updates (chat replies, AJAX, modal opens) — selectors from the prior snapshot are stale once the page mutates.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => formatPage(await runBrowse('browse-extract', '', { cmd: 'extract_content' })),
};

const currentUrl: Tool<Record<string, never>, { url: string }> = {
  name: 'browse-current-url',
  description: 'Return just the URL of the active tab. Cheaper than browse-extract when you only need to confirm a navigation landed.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => ({ url: await runBrowse('browse-current-url', '', { cmd: 'current_url' }) }),
};

const screenshot: Tool<Record<string, never>, { png_b64: string }> = {
  name: 'browse-screenshot',
  description: 'Capture a PNG screenshot of the active tab. Returns { png_b64 }. Useful when text extraction misses visual structure (charts, layouts, captchas).',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => runBrowse('browse-screenshot', '', { cmd: 'screenshot' }),
};

const checkChallenge: Tool<Record<string, never>, { challenge: string | null; url: string }> = {
  name: 'browse-check-challenge',
  description: 'Check whether the active tab is on a known interstitial (google /sorry, cloudflare cdn-cgi, captcha). Returns `challenge` = type or null.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => runBrowse('browse-check-challenge', '', { cmd: 'check_challenge' }),
};

// ── DOM interaction ───────────────────────────────────────────────────

const click: Tool<{ selector: string }, boolean> = {
  name: 'browse-click',
  description: 'Click an element matched by CSS selector. Waits up to 10s for clickability. Call browse-extract afterward if the click navigates or mutates the page.',
  argsSchema: '{ selector: string }',
  scopeOf: () => '*',
  handler: async ({ selector }) => {
    if (typeof selector !== 'string' || !selector) {
      throw new Error('browse-click: selector required');
    }
    return runBrowse('browse-click', selector, { cmd: 'click', selector });
  },
};

const type_: Tool<{ selector: string; text: string; clear?: boolean }, boolean> = {
  name: 'browse-type',
  description: 'Type text into an input matched by CSS selector. Does NOT submit — call browse-send-keys with key=RETURN, or browse-click the submit button. Set `clear: false` to append.',
  argsSchema: '{ selector: string, text: string, clear?: boolean }',
  scopeOf: () => '*',
  handler: async ({ selector, text, clear }) => {
    if (typeof selector !== 'string' || !selector) {
      throw new Error('browse-type: selector required');
    }
    if (typeof text !== 'string') {
      throw new Error('browse-type: text must be a string');
    }
    return runBrowse('browse-type', selector, { cmd: 'type_text', selector, text, clear: clear !== false });
  },
};

const sendKeys: Tool<{ selector: string; key: string }, boolean> = {
  name: 'browse-send-keys',
  description: 'Send a Selenium named key (RETURN, ENTER, TAB, ESCAPE, ARROW_DOWN, etc.) to a selector. The chat/search-box submit-after-type idiom.',
  argsSchema: '{ selector: string, key: string }',
  scopeOf: () => '*',
  handler: async ({ selector, key }) => {
    if (typeof selector !== 'string' || !selector) {
      throw new Error('browse-send-keys: selector required');
    }
    return runBrowse('browse-send-keys', `${selector} ${key || 'RETURN'}`, { cmd: 'send_keys', selector, key: key || 'RETURN' });
  },
};

const executeJs: Tool<{ script: string }, any> = {
  name: 'browse-execute-js',
  description: 'Run a JavaScript expression in the page context. Returns the script result. Power tool — prefer browse-extract / browse-click first.',
  argsSchema: '{ script: string }',
  scopeOf: () => '*',
  handler: async ({ script }) => {
    if (typeof script !== 'string' || !script) {
      throw new Error('browse-execute-js: script required');
    }
    return runBrowse('browse-execute-js', `${script.slice(0, 40)}${script.length > 40 ? '…' : ''}`, { cmd: 'execute_js', script });
  },
};

// ── history / refresh ─────────────────────────────────────────────────

const back: Tool<Record<string, never>, boolean> = {
  name: 'browse-back',
  description: 'Go back one entry in the active tab\'s history.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => runBrowse('browse-back', '', { cmd: 'back' }),
};

const forward: Tool<Record<string, never>, boolean> = {
  name: 'browse-forward',
  description: 'Go forward one entry in the active tab\'s history.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => runBrowse('browse-forward', '', { cmd: 'forward' }),
};

const refresh: Tool<Record<string, never>, boolean> = {
  name: 'browse-refresh',
  description: 'Reload the active tab.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => runBrowse('browse-refresh', '', { cmd: 'refresh' }),
};

// ── tabs ──────────────────────────────────────────────────────────────

const listTabs: Tool<Record<string, never>, { tabs: Array<{ index: number; title: string; url: string; active: boolean }> }> = {
  name: 'browse-list-tabs',
  description: 'List all non-private tabs in the session (index, title, url, active). Indexes are virtual — they skip private tabs.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: async () => runBrowse('browse-list-tabs', '', { cmd: 'list_tabs' }),
};

const useTab: Tool<{ index: number }, { index: number; title: string; url: string }> = {
  name: 'browse-use-tab',
  description: 'Switch the agent\'s active tab by virtual index. Call browse-list-tabs first to discover indexes. Does not steal focus from the user.',
  argsSchema: '{ index: number }',
  scopeOf: () => '*',
  handler: async ({ index }) => {
    if (typeof index !== 'number') throw new Error('browse-use-tab: index must be a number');
    return runBrowse('browse-use-tab', `#${index}`, { cmd: 'use_tab', index });
  },
};

const openTab: Tool<{ url?: string }, any> = {
  name: 'browse-open-tab',
  description: 'Open a new background tab. Returns the updated tab list. Use browse-use-tab to switch the agent\'s focus to it.',
  argsSchema: '{ url?: string }',
  scopeOf: (args) => (args?.url ? hostOf(args.url) : '*'),
  handler: async ({ url }) => runBrowse('browse-open-tab', url ? hostOf(url) : '', { cmd: 'open_tab', url: url || 'about:blank' }),
};

// ── registration ──────────────────────────────────────────────────────

let _registered = false;
export function registerBrowseTools(): void {
  if (_registered) return;
  _registered = true;
  register(navigate);
  register(extract);
  register(currentUrl);
  register(screenshot);
  register(checkChallenge);
  register(click);
  register(type_);
  register(sendKeys);
  register(executeJs);
  register(back);
  register(forward);
  register(refresh);
  register(listTabs);
  register(useTab);
  register(openTab);
}
