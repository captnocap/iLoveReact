// ifttt-permission — detects Claude Code permission prompts via terminal
// scraping and emits them onto the IFTTT bus.
//
// Claude Code has no hook for permission events. The only signal is visual:
// the permission prompt renders in the terminal as a bordered box with
// "Do you want to ..." text and numbered menu options. The framework's
// semantic classifier (framework/terminal/classifier.zig) already tags
// these rows as 'permission', 'menu_title', 'menu_option', 'menu_desc',
// and 'hint', and sets SessionState.permission_pending = true.
//
// This module polls the semantic state and, on a false→true edge of
// permission_pending, scrapes the classified rows to extract:
//   - tool: the tool requesting permission (e.g. "Write", "Bash", "Edit")
//   - target: the file path or command (e.g. "hook_test.txt")
//   - options: the menu choices (e.g. ["Yes", "Yes, allow all edits...", "No"])
//   - fullText: the raw permission prompt text
//
// Bus channels emitted:
//   'system:permission'           — every permission prompt detected
//   'system:permission:<tool>'    — filtered by tool name (lowercase)
//   'system:permission:dismissed' — when permission_pending goes true→false
//
// IFTTT trigger sources registered:
//   'permission:'                 — prefix for all permission triggers
//   'permission:any'              — fires on any permission prompt
//   'permission:<tool>'           — fires for a specific tool
//   'permission:dismissed'        — fires when the prompt is answered/dismissed
//
// Examples:
//   useIFTTT('permission:any', (e) => console.log('Permission for', e.tool))
//   useIFTTT('permission:write', 'log:write permission requested')
//   useIFTTT('permission:bash', (e) => autoApprove(e))
//   useIFTTT('permission:dismissed', 'send:permission-handled')

import { callHost, emit, subscribe } from '../../ffi';
import { registerIfttSource, registerIfttAction } from './registry';

declare module './types/events' {
  interface IFTTTEventMap {
    'system:permission':            PermissionEvent;
    'system:permission:dismissed':  { at: number };
  }
}

const call = (name: string, ...args: any[]): any => callHost<any>(name, undefined, ...args);

// Canonical Claude Code tool names. Permission prompt verbs map to these
// so `permission:Write` aligns with `PreToolUse { tool_name: 'Write' }`.
const VERB_TO_TOOL: Record<string, string> = {
  create: 'Write', write: 'Write', overwrite: 'Write', delete: 'Write',
  edit: 'Edit', modify: 'Edit', update: 'Edit',
  run: 'Bash', execute: 'Bash', allow: 'Bash',
  read: 'Read',
  search: 'WebSearch',
  fetch: 'WebFetch',
  spawn: 'Agent',
};

function classifyOption(text: string): string | null {
  const t = text.toLowerCase();
  if (/^no[,.]?\s*$/.test(t) || t === 'no, exit' || t.startsWith('no,')) return 'no';
  if (/^yes[,.]?\s*$/.test(t) || t.startsWith('yes, i trust')) return 'yes';
  if (t.includes('allow all') && t.includes('session')) return 'always_session';
  if (t.includes('allow all')) return 'always';
  return null;
}

export interface PermissionEvent {
  tool: string;
  target: string;
  options: Record<string, string>;
  fullText: string;
  at: number;
}

// ── Scraper ─────────────────────────────────────────────────────────

function scrapePermission(): PermissionEvent | null {
  const cacheCount: number = call('__sem_cache_count') ?? 0;
  if (cacheCount === 0) return null;

  const rows: Array<{ kind: string; text: string }> = [];
  for (let i = 0; i < cacheCount; i++) {
    const entry = call('__sem_cache_entry', i);
    if (entry && typeof entry === 'object') {
      rows.push({ kind: entry.kind ?? 'text', text: entry.text ?? '' });
    }
  }

  let permStart = -1;
  let permEnd = rows.length - 1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const k = rows[i].kind;
    if (k === 'permission' || k === 'menu_title' || k === 'menu_option' ||
        k === 'menu_desc' || k === 'hint' || k === 'input_border') {
      permStart = i;
    } else if (permStart !== -1) {
      break;
    }
  }

  if (permStart < 0) return null;

  const block = rows.slice(permStart, permEnd + 1);
  const fullText = block.map(r => r.text).join('\n').trim();
  const options: Record<string, string> = {};
  let tool = '';
  let target = '';

  // Collect options, joining menu_desc continuation lines.
  let currentOpt = '';
  for (const row of block) {
    if (row.kind === 'menu_option') {
      if (currentOpt) {
        const key = classifyOption(currentOpt);
        if (key) options[key] = currentOpt;
      }
      currentOpt = row.text.replace(/^\s*[›>]?\s*\d+\.\s*/, '').trim();
    } else if (row.kind === 'menu_desc' && currentOpt) {
      currentOpt += ' ' + row.text.trim();
    } else if (row.kind === 'hint' && currentOpt) {
      const key = classifyOption(currentOpt);
      if (key) options[key] = currentOpt;
      currentOpt = '';
    }
  }
  if (currentOpt) {
    const key = classifyOption(currentOpt);
    if (key) options[key] = currentOpt;
  }

  const titleRows = block.filter(r => r.kind === 'permission' || r.kind === 'menu_title');
  const titleText = titleRows.map(r => r.text).join(' ').trim();

  // "Tool(target)" header style
  const headerMatch = titleText.match(/\b(\w+)\s*\(([^)]+)\)/);
  if (headerMatch) {
    tool = headerMatch[1];
    target = headerMatch[2].trim();
  }

  // "Do you want to <verb> <target>"
  if (!tool) {
    const doMatch = titleText.match(/want to (\w+)\s+(.+?)[\s?]*$/i);
    if (doMatch) {
      const verb = doMatch[1].toLowerCase();
      target = doMatch[2].replace(/\?$/, '').trim();
      tool = VERB_TO_TOOL[verb] || verb;
    }
  }

  // "Accessing workspace:"
  if (!tool) {
    const wsMatch = titleText.match(/Accessing workspace/i);
    if (wsMatch) {
      tool = 'WorkspaceTrust';
      const pathMatch = fullText.match(/Accessing workspace:\s*\n\s*\n?\s*(\S+)/);
      if (pathMatch) target = pathMatch[1];
    }
  }

  // "Create file <path>" / "Edit file <path>"
  if (!tool) {
    const actionMatch = titleText.match(/\b(Create|Edit|Write|Read|Delete)\s+(?:file\s+)?(\S+)/i);
    if (actionMatch) {
      const verb = actionMatch[1].toLowerCase();
      tool = VERB_TO_TOOL[verb] || verb;
      target = actionMatch[2];
    }
  }

  if (!tool) tool = 'unknown';

  return { tool, target, options, fullText, at: Date.now() };
}

// ── Poller ──────────────────────────────────────────────────────────

let _prevPending = false;
let _pollId: ReturnType<typeof setInterval> | null = null;

function poll(): void {
  const state = call('__sem_state');
  const pending = !!(state && typeof state === 'object' && state.mode_name === 'permission');

  if (pending && !_prevPending) {
    const ev = scrapePermission();
    if (ev) {
      emit('system:permission', ev);
      if (ev.tool && ev.tool !== 'unknown') {
        emit(`system:permission:${ev.tool}`, ev);
      }
    }
  } else if (!pending && _prevPending) {
    emit('system:permission:dismissed', { at: Date.now() });
  }

  _prevPending = pending;
}

function ensurePolling(): void {
  if (_pollId !== null) return;
  _pollId = setInterval(poll, 150);
}

// ── IFTTT source registrations ──────────────────────────────────────

registerIfttSource('permission:', {
  match(spec) {
    if (!spec.startsWith('permission:')) return null;
    const rest = spec.slice('permission:'.length);

    if (rest === 'any') {
      return {
        subscribe(onFire) {
          ensurePolling();
          return subscribe('system:permission', onFire);
        },
      };
    }

    if (rest === 'dismissed') {
      return {
        subscribe(onFire) {
          ensurePolling();
          return subscribe('system:permission:dismissed', onFire);
        },
      };
    }

    // permission:<tool> — subscribe to the tool-specific channel
    return {
      subscribe(onFire) {
        ensurePolling();
        return subscribe(`system:permission:${rest}`, onFire);
      },
    };
  },
});

// ── IFTTT action verbs ──────────────────────────────────────────────
//
// Answer Claude Code permission prompts from inside the IFTTT DSL. The
// permission menu always has numbered options — option 1 is Yes, option
// 3 is No (option 2 is "Yes, allow all edits during this session" which
// we deliberately don't surface as an action since it's destructive).
//
// Examples (in a cart's useIFTTT body):
//   useIFTTT('permission:any', 'permission:approve')      // approve everything
//   useIFTTT('permission:bash', 'permission:deny')        // deny all bash
//   useIFTTT('permission:any', 'approve-if-target-ext:.md,.txt,.json')
//   useIFTTT('permission:any', 'approve-if-tool:Read,WebFetch')
//   useIFTTT('permission:any', 'deny-if-tool:Bash')
//   useIFTTT('permission:any', 'approve-if-target-word:docs/,README')
//
// The actions write to vterm slot 0. Single-vterm assumption matches the
// rest of the TUI host (see framework/v8_bindings_vterm.zig: "vterm.zig
// backs a single global PTY today").

// Per-session __vterm_write(name, data). Empty string falls through
// to DEFAULT_SESSION on the Zig side (see argSessionAlloc), so passing
// '' targets whichever pipe the cart's Terminal pinned to default —
// which is the canonical setup for single-Terminal carts like claudewrap.
function writeToVterm(s: string): void {
  callHost('__vterm_write', undefined, '', s);
}

// Emit on the bus so observers (IFTTT activity feeds, audit recipes) can
// see which auto-answer fired and why. Carts that bind their own action
// can subscribe to 'system:permission:answered' to react to it.
function announce(verb: 'approve' | 'deny', via: string, payload: any): void {
  emit('system:permission:answered', {
    verb,
    via,
    tool: String(payload?.tool ?? ''),
    target: String(payload?.target ?? ''),
    at: Date.now(),
  });
}

function permissionApprove(via: string, payload: any): void {
  writeToVterm('1\r');
  announce('approve', via, payload);
}
function permissionDeny(via: string, payload: any): void {
  writeToVterm('3\r');
  announce('deny', via, payload);
}

function parseList(raw: string): string[] {
  return raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

function targetMatchesExt(target: string, raw: string): boolean {
  const exts = parseList(raw);
  if (exts.length === 0) return false;
  const t = target.toLowerCase();
  return exts.some(e => {
    const norm = (e.startsWith('.') ? e : '.' + e).toLowerCase();
    return t.endsWith(norm);
  });
}

function targetMatchesWord(target: string, raw: string): boolean {
  const words = parseList(raw);
  if (words.length === 0) return false;
  const t = target.toLowerCase();
  return words.some(w => t.includes(w.toLowerCase()));
}

function toolMatches(tool: string, raw: string): boolean {
  const tools = parseList(raw);
  if (tools.length === 0) return false;
  const t = tool.toLowerCase();
  return tools.some(x => x.toLowerCase() === t);
}

registerIfttAction('permission:approve', (_rest, payload) => permissionApprove('permission:approve', payload));
registerIfttAction('permission:deny',    (_rest, payload) => permissionDeny('permission:deny', payload));

registerIfttAction('approve-if-target-ext:', (rest, payload) => {
  if (targetMatchesExt(String(payload?.target ?? ''), rest)) permissionApprove(`approve-if-target-ext:${rest}`, payload);
});
registerIfttAction('deny-if-target-ext:', (rest, payload) => {
  if (targetMatchesExt(String(payload?.target ?? ''), rest)) permissionDeny(`deny-if-target-ext:${rest}`, payload);
});
registerIfttAction('approve-if-target-word:', (rest, payload) => {
  if (targetMatchesWord(String(payload?.target ?? ''), rest)) permissionApprove(`approve-if-target-word:${rest}`, payload);
});
registerIfttAction('deny-if-target-word:', (rest, payload) => {
  if (targetMatchesWord(String(payload?.target ?? ''), rest)) permissionDeny(`deny-if-target-word:${rest}`, payload);
});
registerIfttAction('approve-if-tool:', (rest, payload) => {
  if (toolMatches(String(payload?.tool ?? ''), rest)) permissionApprove(`approve-if-tool:${rest}`, payload);
});
registerIfttAction('deny-if-tool:', (rest, payload) => {
  if (toolMatches(String(payload?.tool ?? ''), rest)) permissionDeny(`deny-if-tool:${rest}`, payload);
});

// Start polling immediately on import (same pattern as turn-tracker).
ensurePolling();
