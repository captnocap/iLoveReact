/**
 * React-reconciler host config for the native (QuickJS FFI) renderer.
 *
 * Ported from reactor01's renderer.js to TypeScript.
 * Emits mutation commands (CREATE, APPEND, UPDATE, etc.) that get serialized
 * as JSON and sent to Lua via __hostFlush.
 */

import type { HostConfig } from 'react-reconciler';
import { reportError } from './errorReporter';
import { debugLog } from './debugLog';
import { tw } from '@reactjit/core';
import { manageSubscription, cleanupSubscriptionsRecursive } from './subscriptionManager';

// ── Hotkey combo parser (shared with hooks.ts) ──────────────────────

interface ParsedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+').map(s => s.trim());
  const result: ParsedCombo = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') result.ctrl = true;
    else if (part === 'shift') result.shift = true;
    else if (part === 'alt') result.alt = true;
    else if (part === 'meta' || part === 'cmd' || part === 'gui') result.meta = true;
    else result.key = part;
  }
  return result;
}

function matchesCombo(event: any, parsed: ParsedCombo): boolean {
  if (!!event.ctrl !== parsed.ctrl) return false;
  if (!!event.shift !== parsed.shift) return false;
  if (!!event.alt !== parsed.alt) return false;
  if (!!event.meta !== parsed.meta) return false;
  return (event.key ?? '').toLowerCase() === parsed.key;
}

function makeComboFilter(combo: string): (payload: any) => boolean {
  const parsed = parseCombo(combo);
  return (payload: any) => matchesCombo(payload, parsed);
}

// ── HTML Element Remapping ───────────────────────────────────────────
// Maps standard HTML element types to ReactJIT host types so that
// <div>, <span>, <h1>, <img>, etc. just work without modification.
// Lua never sees unknown types — the remap happens before CREATE.

const HTML_TYPE_MAP: Record<string, string> = {
  // Container elements → View
  'div': 'View', 'section': 'View', 'article': 'View', 'aside': 'View',
  'main': 'View', 'nav': 'View', 'header': 'View', 'footer': 'View',
  'form': 'View', 'fieldset': 'View', 'figure': 'View', 'figcaption': 'View',
  'ul': 'View', 'ol': 'View', 'li': 'View', 'dl': 'View', 'dt': 'View', 'dd': 'View',
  'table': 'View', 'thead': 'View', 'tbody': 'View', 'tfoot': 'View',
  'tr': 'View', 'td': 'View', 'th': 'View', 'caption': 'View',
  'a': 'View', 'button': 'View', 'details': 'View', 'summary': 'View',
  'dialog': 'View', 'menu': 'View',
  // Text elements → Text
  'span': 'Text', 'p': 'Text', 'label': 'Text',
  'h1': 'Text', 'h2': 'Text', 'h3': 'Text',
  'h4': 'Text', 'h5': 'Text', 'h6': 'Text',
  'strong': 'Text', 'b': 'Text', 'em': 'Text', 'i': 'Text',
  'code': 'Text', 'small': 'Text', 'mark': 'Text',
  'abbr': 'Text', 'cite': 'Text', 'q': 'Text', 'time': 'Text',
  'sub': 'Text', 'sup': 'Text',
  // Media → native equivalents
  'img': 'Image', 'video': 'Video',
  'input': 'TextInput', 'textarea': 'TextEditor',
  'pre': 'CodeBlock',
  'math': 'Math',
  // Ignored structural (map to View so they don't break)
  'html': 'View', 'body': 'View', 'head': 'View',
  'br': 'View', 'hr': 'View', 'wbr': 'View',
};

// Heading font sizes (matching common browser defaults)
const HEADING_FONT_SIZE: Record<string, number> = {
  h1: 32, h2: 28, h3: 24, h4: 20, h5: 18, h6: 16,
};

// HTML-only props that should not cross the bridge
const HTML_STRIP_PROPS = new Set([
  'alt', 'htmlFor', 'href', 'target', 'rel', 'method', 'action',
  'encType', 'noValidate', 'autoComplete', 'role', 'tabIndex',
  'type', 'min', 'max', 'step', 'checked', 'selected', 'multiple',
  'cols', 'rows', 'wrap', 'spellCheck', 'inputMode', 'pattern',
  'required', 'readOnly', 'disabled', 'name', 'form', 'list',
  'aria-label', 'aria-hidden', 'aria-describedby', 'aria-labelledby',
  'data-testid', 'data-cy',
]);

/**
 * Transform HTML props into ReactJIT-compatible props.
 * Only called when the element type is in HTML_TYPE_MAP.
 */
function resolveHtmlProps(originalType: string, props: Record<string, any>): Record<string, any> {
  const resolved: Record<string, any> = {};
  const mergeStyle = (base: Record<string, any> | undefined, patch: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = {};
    if (base) {
      for (const key of Object.keys(base)) out[key] = base[key];
    }
    for (const key of Object.keys(patch)) out[key] = patch[key];
    return out;
  };

  for (const key of Object.keys(props)) {
    if (key === 'children') continue;
    if (HTML_STRIP_PROPS.has(key)) continue;
    // Strip any aria-* and data-* attributes
    if (key.startsWith('aria-') || key.startsWith('data-')) continue;
    resolved[key] = props[key];
  }

  // className → tw() → merge into style (style wins on conflicts)
  if (resolved.className && typeof resolved.className === 'string') {
    const twStyle = tw(resolved.className);
    resolved.style = resolved.style ? mergeStyle(twStyle, resolved.style) : twStyle;
    delete resolved.className;
  }

  // Heading defaults: fontSize + bold
  const headingSize = HEADING_FONT_SIZE[originalType];
  if (headingSize) {
    const headingStyle = { fontSize: headingSize, fontWeight: 'bold' as const };
    resolved.style = resolved.style ? mergeStyle(headingStyle, resolved.style) : headingStyle;
  }

  // strong/b → bold
  if (originalType === 'strong' || originalType === 'b') {
    const boldStyle = { fontWeight: 'bold' as const };
    resolved.style = resolved.style ? mergeStyle(boldStyle, resolved.style) : boldStyle;
  }

  // img: src → source
  if (originalType === 'img' && resolved.src) {
    resolved.source = resolved.src;
    delete resolved.src;
  }

  // input/textarea: coerce value to string (Lua textinput expects string, not number)
  if ((originalType === 'input' || originalType === 'textarea') && resolved.value != null) {
    resolved.value = String(resolved.value);
  }

  // Note: onClick is NOT remapped — the event dispatcher already dispatches
  // press events as 'onClick'. Handlers pass through as-is.

  return resolved;
}

// ── Types ────────────────────────────────────────────────

export interface Instance {
  id: number;
  type: string;
  props: Record<string, any>;
  handlers: Record<string, Function>;
  children: Instance[];
  renderCount: number;
  parent?: Instance | null;
  hostWindowId?: number | null;
  debugName?: string;
  debugSource?: { fileName?: string; lineNumber?: number };
}

export interface TextInstance {
  id: number;
  text: string;
  parent?: Instance | null;
}

type Container = { id: number };
type Props = Record<string, any>;
type UpdatePayload = Record<string, any> | null;

interface Command {
  op: string;
  [key: string]: any;
}

// ── Globals / FFI bridge ─────────────────────────────────

declare const globalThis: {
  __hostFlush: (commands: string | Command[]) => void;
  __hostGetEvents: () => any[];
  __hostLog?: (level: number, msg: string) => void;
  _pollAndDispatchEvents?: () => void;
  [key: string]: any;
};

// Per-call `[hostConfig] ...` tracing is noisy on real carts. Kept as a
// no-op function so all existing call sites stay valid; flip this back
// when you need to inspect reconciler decisions.
function hostLog(_msg: string): void {}

// ── Transport abstraction ────────────────────────────────

/** Injected flush handler — decouples the reconciler from a specific transport. */
let transportFlush: ((commands: Command[]) => void) | null = null;

/**
 * Register the transport flush handler.
 * Called by the bridge implementation (NativeBridge, WebSocketBridge, etc.)
 * to tell the reconciler how to deliver commands.
 */
export function setTransportFlush(fn: (commands: Command[]) => void): void {
  transportFlush = fn;
}

// ── State ────────────────────────────────────────────────

let nodeIdCounter = 0;
const pendingCommands: Command[] = [];
const rootInstances: Instance[] = [];

type ChurnTraceRecord = {
  op: string;
  id: number;
  parentId?: number | null;
  type: string;
  name: string;
  source: string;
  nodes: number;
  glyphs: number;
  detail?: string;
};

let churnTraceEnvEnabled: boolean | null = null;
let churnTraceCommit = 0;
const churnTraceBatch: ChurnTraceRecord[] = [];
const churnTraceRecent: Array<{ commit: number; at: number; events: number; nodes: number; glyphs: number; parts: string[] }> = [];
const CHURN_TRACE_RECENT_MAX = 16;

function isDiagnosticConsoleChurn(record: ChurnTraceRecord): boolean {
  const detail = record.detail ?? '';
  if (record.name !== 'PlayRoute') return false;
  return (
    detail.includes('gv_churntrace') ||
    detail.includes('gv_perflog') ||
    detail.includes('help ·') ||
    detail.includes('PgUp/PgDn') ||
    /text="] .*▌"/.test(detail) ||
    /^"] .*▌"=>"] ▌"/.test(detail)
  );
}

function churnTraceEnabled(): boolean {
  if ((globalThis as any).__RECON_CHURN_TRACE === true) return true;
  if ((globalThis as any).__RECON_CHURN_TRACE === false) return false;
  if (churnTraceEnvEnabled != null) return churnTraceEnvEnabled;
  let value: any = null;
  try {
    const envGet = (globalThis as any).__env_get;
    value = typeof envGet === 'function' ? envGet('RJIT_RECON_CHURN_TRACE') : null;
  } catch {
    value = null;
  }
  churnTraceEnvEnabled = value != null && value !== '' && value !== '0' && value !== 'false';
  return churnTraceEnvEnabled;
}

function sourceLabel(source?: { fileName?: string; lineNumber?: number }): string {
  if (!source?.fileName) return 'unknown';
  return `${source.fileName}${source.lineNumber ? `:${source.lineNumber}` : ''}`;
}

function previewText(text: string): string {
  return JSON.stringify(text.length > 32 ? `${text.slice(0, 32)}...` : text);
}

function propFontSize(props: Record<string, any> | undefined): unknown {
  if (!props) return undefined;
  if (props.fontSize != null) return props.fontSize;
  if (props.style && typeof props.style === 'object' && props.style.fontSize != null) return props.style.fontSize;
  return undefined;
}

function collectTextPreview(node: Instance | TextInstance, out: string[], limit = 4): void {
  if (out.length >= limit) return;
  if (!isInstance(node)) {
    out.push(node.text);
    return;
  }
  for (const child of node.children as Array<Instance | TextInstance>) {
    collectTextPreview(child, out, limit);
    if (out.length >= limit) return;
  }
}

function textOwnerDetail(node: Instance | TextInstance, props?: Record<string, any>): string {
  const owner = isInstance(node) ? node : node.parent ?? undefined;
  const texts: string[] = [];
  collectTextPreview(node, texts);
  const bits: string[] = [];
  const size = propFontSize(props ?? owner?.props);
  if (size != null) bits.push(`fontSize=${String(size)}`);
  if (texts.length > 0) bits.push(`text=${texts.map(previewText).join('|')}`);
  return bits.join(' ');
}

function updateChurnDetail(instance: Instance, oldProps: Record<string, any>, newProps: Record<string, any>, diffKeys: string[]): string {
  const bits: string[] = [];
  const oldSize = propFontSize(oldProps);
  const newSize = propFontSize(newProps);
  bits.push(diffKeys.join(','));
  if (oldSize !== newSize) bits.push(`fontSize ${String(oldSize ?? 'unset')}=>${String(newSize ?? 'unset')}`);
  const text = textOwnerDetail(instance, newProps);
  if (text) bits.push(text);
  return bits.filter(Boolean).join(' ');
}

function nodeLabel(node: Instance | TextInstance): { name: string; source: string; type: string } {
  if (isInstance(node)) {
    return {
      name: node.debugName ?? node.type,
      source: sourceLabel(node.debugSource),
      type: node.type,
    };
  }
  const parent = node.parent ?? null;
  return {
    name: parent?.debugName ?? parent?.type ?? 'Text',
    source: sourceLabel(parent?.debugSource),
    type: 'Text',
  };
}

function subtreeCounts(node: Instance | TextInstance): { nodes: number; glyphs: number } {
  if (!isInstance(node)) return { nodes: 1, glyphs: node.text.length };
  let nodes = 1;
  let glyphs = 0;
  for (const child of node.children as Array<Instance | TextInstance>) {
    const counts = subtreeCounts(child);
    nodes += counts.nodes;
    glyphs += counts.glyphs;
  }
  return { nodes, glyphs };
}

function recordChurn(op: string, node: Instance | TextInstance, counts?: { nodes: number; glyphs: number }, detail?: string): void {
  if (!churnTraceEnabled()) return;
  const label = nodeLabel(node);
  const c = counts ?? subtreeCounts(node);
  const nodeDetail = detail ?? (c.glyphs > 0 ? textOwnerDetail(node) : undefined);
  churnTraceBatch.push({
    op,
    id: node.id,
    parentId: node.parent?.id ?? null,
    type: label.type,
    name: label.name,
    source: label.source,
    nodes: c.nodes,
    glyphs: c.glyphs,
    detail: nodeDetail,
  });
}

function flushChurnTrace(): void {
  if (!churnTraceEnabled() || churnTraceBatch.length === 0) return;
  for (let i = churnTraceBatch.length - 1; i >= 0; i -= 1) {
    if (isDiagnosticConsoleChurn(churnTraceBatch[i])) churnTraceBatch.splice(i, 1);
  }
  if (churnTraceBatch.length === 0) return;
  churnTraceCommit += 1;
  const total = churnTraceBatch.reduce((acc, r) => {
    acc.nodes += r.nodes;
    acc.glyphs += r.glyphs;
    return acc;
  }, { nodes: 0, glyphs: 0 });
  const groups = new Map<string, ChurnTraceRecord & { count: number; ids: number[]; parentIds: Array<number | null | undefined> }>();
  for (const record of churnTraceBatch) {
    const key = `${record.op}|${record.name}|${record.source}|${record.type}|${record.detail ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.nodes += record.nodes;
      existing.glyphs += record.glyphs;
      if (existing.ids.length < 8) existing.ids.push(record.id);
      if (existing.parentIds.length < 8) existing.parentIds.push(record.parentId);
      if (record.detail && !existing.detail?.includes(record.detail)) {
        existing.detail = existing.detail ? `${existing.detail},${record.detail}` : record.detail;
      }
    } else {
      groups.set(key, { ...record, count: 1, ids: [record.id], parentIds: [record.parentId] });
    }
  }
  const parts = [...groups.values()]
    .sort((a, b) => (b.glyphs - a.glyphs) || (b.nodes - a.nodes))
    .slice(0, 8)
    .map((g) => {
      const parents = [...new Set(g.parentIds.map((id) => id == null ? 'root' : String(id)))].join(',');
      return `${g.op} ${g.name}@${g.source} type=${g.type} count=${g.count} ids=${g.ids.join(',')} parents=${parents} nodes=${g.nodes} glyphs=${g.glyphs}${g.detail ? ` detail=${g.detail}` : ''}`;
    });
  churnTraceRecent.push({ commit: churnTraceCommit, at: Date.now(), events: churnTraceBatch.length, nodes: total.nodes, glyphs: total.glyphs, parts });
  if (churnTraceRecent.length > CHURN_TRACE_RECENT_MAX) churnTraceRecent.splice(0, churnTraceRecent.length - CHURN_TRACE_RECENT_MAX);
  try {
    globalThis.console?.warn?.(`[recon-churn] commit=${churnTraceCommit} events=${churnTraceBatch.length} nodes=${total.nodes} glyphs=${total.glyphs}\n  ${parts.join('\n  ')}`);
  } catch {}
  churnTraceBatch.length = 0;
}

(globalThis as any).__RECON_CHURN_SET = (enabled: unknown) => {
  (globalThis as any).__RECON_CHURN_TRACE = enabled === true || enabled === 1 || enabled === '1' || enabled === 'on';
  if ((globalThis as any).__RECON_CHURN_TRACE) churnTraceRecent.length = 0;
  return (globalThis as any).__RECON_CHURN_TRACE;
};
(globalThis as any).__RECON_CHURN_DUMP = () => churnTraceRecent.slice();
(globalThis as any).__RECON_CHURN_CLEAR = () => {
  churnTraceBatch.length = 0;
  churnTraceRecent.length = 0;
  return true;
};
(globalThis as any).__RECON_CHURN_STATUS = () => ({ enabled: churnTraceEnabled(), recent: churnTraceRecent.length });
const WINDOW_HOST_TYPES = new Set(['Window', 'Notification']);

/**
 * Get the current root-level instances.
 * Used by remote targets (e.g., CC) to walk the JS-side tree
 * instead of sending mutation commands to a Lua bridge.
 */
export function getRootInstances(): Instance[] {
  return rootInstances;
}

/**
 * Registry of event handlers keyed by nodeId.
 * Handlers never cross the bridge — they stay in JS.
 * Lua sends events referencing targetId, and we dispatch here.
 */
export const handlerRegistry = new Map<number, Record<string, Function>>();

// ── Helpers ──────────────────────────────────────────────

function emit(cmd: Command): void {
  pendingCommands.push(cmd);
}

function isInstance(node: Instance | TextInstance): node is Instance {
  return !!node && 'children' in node;
}

function assignHostWindow(node: Instance | TextInstance, windowId: number | null): void {
  if (!isInstance(node)) return;
  node.hostWindowId = WINDOW_HOST_TYPES.has(node.type) ? node.id : windowId;
  for (const child of node.children) {
    assignHostWindow(child as any, node.hostWindowId ?? null);
  }
}

function markParent(parent: Instance | null, child: Instance | TextInstance): void {
  child.parent = parent;
  if (!isInstance(child)) return;
  const inherited = parent ? (WINDOW_HOST_TYPES.has(parent.type) ? parent.id : parent.hostWindowId ?? null) : null;
  assignHostWindow(child, inherited);
}

function buildWindowOwnerMap(): { ownerById: Map<number, number>; windowRoots: Set<number> } {
  const ownerById = new Map<number, number>();
  const windowRoots = new Set<number>();

  const walk = (node: Instance | TextInstance, inherited: number | null): void => {
    if (!isInstance(node)) return;
    const ownWindow = WINDOW_HOST_TYPES.has(node.type) ? node.id : inherited;
    node.hostWindowId = ownWindow;
    if (WINDOW_HOST_TYPES.has(node.type)) windowRoots.add(node.id);
    if (ownWindow != null && node.id !== ownWindow) ownerById.set(node.id, ownWindow);
    for (const child of node.children) walk(child as any, ownWindow);
  };

  for (const root of rootInstances) walk(root, null);
  return { ownerById, windowRoots };
}

function annotateWindowCommands(commands: Command[]): void {
  const { ownerById, windowRoots } = buildWindowOwnerMap();
  const traceWindows = !!(globalThis as any).__TRACE_WINDOWS;
  for (const cmd of commands) {
    if (cmd.window_id != null) continue;
    const id = typeof cmd.id === 'number' ? cmd.id : undefined;
    const childId = typeof cmd.childId === 'number' ? cmd.childId : undefined;
    const parentId = typeof cmd.parentId === 'number' ? cmd.parentId : undefined;
    const owner =
      (id != null ? ownerById.get(id) : undefined) ??
      (childId != null ? ownerById.get(childId) : undefined) ??
      (parentId != null ? ownerById.get(parentId) : undefined) ??
      (parentId != null && windowRoots.has(parentId) ? parentId : undefined);
    if (owner != null) {
      cmd.window_id = owner;
      cmd.windowId = owner;
      if (traceWindows && (cmd.op === 'CREATE' || cmd.op === 'APPEND' || cmd.op === 'APPEND_TO_ROOT' || cmd.op === 'REMOVE')) {
        try {
          (globalThis as any).__hostLog?.(0, `[window-route/js] op=${cmd.op} id=${cmd.id ?? ''} parent=${cmd.parentId ?? ''} child=${cmd.childId ?? ''} window=${owner}`);
        } catch {}
      }
    }
  }
}

function commandWithWindow(cmd: Command, windowId: number | null | undefined): Command {
  if (windowId == null) return cmd;
  return { ...cmd, window_id: windowId, windowId };
}

/**
 * Merge multiple UPDATE commands targeting the same node into a single command.
 * Non-UPDATE commands and UPDATEs for distinct nodes pass through unchanged.
 */
function coalesceCommands(commands: Command[]): Command[] {
  const updateMap = new Map<number, number>(); // nodeId -> index in output
  const output: Command[] = [];

  const cloneValue = (value: any): any => {
    if (Array.isArray(value)) {
      const out: any[] = [];
      for (let i = 0; i < value.length; i++) out[i] = cloneValue(value[i]);
      return out;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const key of Object.keys(value)) {
        out[key] = cloneValue(value[key]);
      }
      return out;
    }
    return value;
  };

  const mergePlainObject = (base: Record<string, any>, patch: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const key of Object.keys(base)) out[key] = cloneValue(base[key]);
    for (const key of Object.keys(patch)) out[key] = cloneValue(patch[key]);
    return out;
  };

  const cloneCommand = (cmd: Command): Command => {
    const out: any = {};
    for (const key of Object.keys(cmd as any)) {
      out[key] = cloneValue((cmd as any)[key]);
    }
    return out as Command;
  };

  for (const cmd of commands) {
    if (cmd.op === 'UPDATE' && cmd.id != null) {
      const existingIdx = updateMap.get(cmd.id);
      if (existingIdx !== undefined) {
        const existing = output[existingIdx];
        // Snapshot the existing style BEFORE the shallow merge overwrites it.
        // Without this, two UPDATE ops that each carry a single style key
        // (e.g. first {style:{height:N}}, then {style:{width:M}}) would lose
        // the earlier key: the spread on the next line replaces the whole
        // `style` sub-object with `cmd.props.style`, and then the "merge"
        // below sees the same reference on both sides and does nothing.
        const prevStyle = existing.props.style;
        // Merge props (shallow)
        existing.props = mergePlainObject(existing.props || {}, cmd.props || {});
        // Merge style sub-objects — use the pre-merge snapshot as the base
        if (prevStyle && cmd.props.style) {
          existing.props.style = mergePlainObject(prevStyle, cmd.props.style);
        }
        // Merge removal arrays
        if (cmd.removeKeys) {
          existing.removeKeys = [...(existing.removeKeys || []), ...cmd.removeKeys];
        }
        if (cmd.removeStyleKeys) {
          existing.removeStyleKeys = [...(existing.removeStyleKeys || []), ...cmd.removeStyleKeys];
        }
        // Latest hasHandlers wins
        if (cmd.hasHandlers !== undefined) {
          existing.hasHandlers = cmd.hasHandlers;
        }
        if (cmd.handlerNames !== undefined) {
          existing.handlerNames = cmd.handlerNames;
        }
        continue;
      }
      updateMap.set(cmd.id, output.length);
    }
    output.push(cloneCommand(cmd));
  }

  return output;
}

export function flushToHost(): void {
  if (pendingCommands.length === 0) return;

  // Resolve transport on first flush (backwards compat: fall back to global)
  if (!transportFlush) {
    if (typeof globalThis.__hostFlush === 'function') {
      transportFlush = (cmds) => globalThis.__hostFlush(cmds);
    } else {
      return;
    }
  }

  const t0 = (globalThis as any).performance?.now?.() ?? Date.now();
  const pendingN = pendingCommands.length;
  annotateWindowCommands(pendingCommands);
  const coalesced = coalesceCommands(pendingCommands);
  const t1 = (globalThis as any).performance?.now?.() ?? Date.now();
  hostLog(`[hostConfig] flushToHost pending=${pendingCommands.length} coalesced=${coalesced.length}`);
  debugLog.log('recon', `flushToHost pending=${pendingCommands.length} coalesced=${coalesced.length}`);

  try {
    flushCoalesced(coalesced);
    const t3 = (globalThis as any).performance?.now?.() ?? Date.now();
    // Diagnostic gate: log only when the flush is BOTH unusually large
    // AND unusually slow (the interesting case — payload size driving
    // bridge cost). Big-but-fast and slow-but-small flushes are noise,
    // and animation-driven content updates spammed this log every frame
    // because the per-frame UPDATE batch easily clears 100KB on its own.
    if ((t3 - t0) > 100) {
      const gh: any = globalThis as any;
      if (typeof gh.__hostLog === 'function') {
        try { gh.__hostLog(0, `[flush-timing] pending=${pendingN} coalesced=${coalesced.length} coalesce=${(t1-t0).toFixed(1)}ms total=${(t3-t0).toFixed(1)}ms`); } catch {}
      }
    }
  } catch (e) {
    reportError(e, 'flushToHost (' + coalesced.length + ' commands)');
  }
  pendingCommands.length = 0;
}

// V8/QuickJS cap a single string near 2^29 chars. A flush whose JSON would exceed
// that throws RangeError — and the WHOLE batch was being dropped, freezing/desyncing
// the editor (USER report: "flushToHost (4740 commands): Invalid string length").
// Serialize the batch; if it's too big to stringify, BISECT and flush each half in
// order (the host applies batches sequentially, so splitting is transparent). A flush
// that big means something upstream is dumping MBs into the command stream (a prop
// carrying mesh verts / instance arrays / a paint atlas), so warn — and a single
// command too large to split is NAMED (id/type/prop keys), surfacing the bloat rather
// than hiding it behind a crash.
const OVERSIZE_FLUSH_WARN_BYTES = 50_000_000;

function flushCoalesced(cmds: Command[]): void {
  let payload: string | null = null;
  try { payload = JSON.stringify(cmds); } catch { payload = null; }
  if (payload !== null) {
    if (payload.length > OVERSIZE_FLUSH_WARN_BYTES) {
      const gh: any = globalThis as any;
      if (typeof gh.__hostLog === 'function') {
        try { gh.__hostLog(0, `[flush-oversize] ${cmds.length} cmd(s) → ${payload.length} bytes. biggest: ${describeBiggestCommands(cmds, 3)}`); } catch {}
      }
    }
    (transportFlush as unknown as (p: string) => void)(payload);
    return;
  }
  if (cmds.length <= 1) {
    reportError(new Error('single command exceeds the JSON string limit'), 'flushToHost oversized command: ' + describeBiggestCommands(cmds, 1));
    return;
  }
  const mid = cmds.length >> 1;
  flushCoalesced(cmds.slice(0, mid));
  flushCoalesced(cmds.slice(mid));
}

/** Top-N commands by serialized size, named for the oversize diagnostic — op, id,
 *  type, byte size, and which prop keys it carries (so the bloated prop is obvious). */
function describeBiggestCommands(cmds: Command[], n: number): string {
  const sized = cmds.map((c) => {
    let len = 0;
    try { len = JSON.stringify(c).length; } catch { len = Number.MAX_SAFE_INTEGER; }
    const props = (c as any).props;
    return { op: c.op, id: (c as any).id, type: (c as any).type, len, keys: props && typeof props === 'object' ? Object.keys(props) : [] };
  }).sort((a, b) => b.len - a.len).slice(0, n);
  return sized.map((s) => `${s.op} id=${s.id ?? '?'} type=${s.type ?? '?'} bytes=${s.len} props=[${s.keys.join(',')}]`).join(' | ');
}

// ── Flush scheduling ─────────────────────────────────────
//
// A single user event can trigger a chain of commits: click sets tab, effect
// syncs derived state, memo invalidates, another effect fires, … React calls
// resetAfterCommit per commit. Flushing synchronously there turns one event
// into N separate __hostFlush calls (10+ seen in the sweatshop tab switch),
// each with its own JSON.stringify + FFI crossing + Zig-side queue entry.
//
// Deferring the flush to a microtask lets all commits in the current
// synchronous span accumulate into pendingCommands first; coalesceCommands
// then merges same-id UPDATEs across commits, and a single bridge call
// leaves the VM. When JS returns to Zig, microtasks drain, Zig sees one
// batch instead of ten.
//
// QuickJS doesn't expose queueMicrotask, but Promise microtasks are drained
// at every JS→native boundary via JS_ExecutePendingJob — which means a
// Promise.resolve().then callback runs after the current JS synchronous span
// returns and before Zig regains control. That's exactly the scheduling point
// we want: all commits from a single event accumulate into pendingCommands,
// then one flush happens on the way out.
let flushScheduled = false;
const microtask: (fn: () => void) => void =
  typeof (globalThis as any).queueMicrotask === 'function'
    ? (globalThis as any).queueMicrotask.bind(globalThis)
    : (fn: () => void) => { Promise.resolve().then(fn); };

export function scheduleFlush(): void {
  hostLog(`[hostConfig] scheduleFlush called scheduled=${flushScheduled} pending=${pendingCommands.length}`);
  if (flushScheduled) return;
  flushScheduled = true;
  microtask(() => {
    hostLog(`[hostConfig] scheduleFlush callback pending=${pendingCommands.length}`);
    flushScheduled = false;
    flushToHost();
  });
}

/**
 * Separate on* handler props from regular props.
 * Handlers stay in JS; only clean props cross the bridge.
 */
export function extractHandlers(
  props: Props
): { clean: Record<string, any>; handlers: Record<string, Function> } {
  const clean: Record<string, any> = {};
  const handlers: Record<string, Function> = {};

  for (const key of Object.keys(props)) {
    if (key === 'children') continue;
    if (key.startsWith('on') && typeof props[key] === 'function') {
      handlers[key] = props[key];
    } else {
      clean[key] = props[key];
    }
  }

  return { clean, handlers };
}

/**
 * Build handler metadata for the inspector.
 * Maps handler names to short readable snippets of the function source.
 */
function buildHandlerMeta(handlers: Record<string, Function>): Record<string, string> | undefined {
  const keys = Object.keys(handlers);
  if (keys.length === 0) return undefined;
  const meta: Record<string, string> = {};
  for (const name of keys) {
    try {
      const src = handlers[name].toString().replace(/\s+/g, ' ').trim();
      meta[name] = src.length > 80 ? src.slice(0, 80) + '\u2026' : src;
    } catch {
      meta[name] = '(native)';
    }
  }
  return meta;
}

/**
 * Shallow equality check for prop diffing.
 */
export function shallowEqual(
  a: Record<string, any>,
  b: Record<string, any>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Compare two handler maps by the *set of handler names* only.
 *
 * Function-identity changes alone never need to cross the bridge: the JS-side
 * handlerRegistry is updated unconditionally in commitUpdate, so when Zig
 * dispatches a press it always walks through the latest closure. Emitting an
 * UPDATE just because `oldProps.onPress !== newProps.onPress` is pure waste —
 * and a parent that rerenders with inline arrow handlers cascades into O(N)
 * UPDATEs per frame across every Pressable in the subtree. That turns a
 * harmless ancestor rerender into a bridge flood (see the sweatshop tab
 * switch incident).
 *
 * Genuine adds/removes (onHoverEnter appearing, onPress disappearing) still
 * return false → Zig learns about them via the __handlersOnly UPDATE branch.
 */
function handlersEqual(a: Record<string, Function>, b: Record<string, Function>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!(k in b)) return false;
  }
  return true;
}

/**
 * Compute a partial diff between two style objects.
 * Returns changed keys (with new values) and removed keys.
 */
function diffStyleObjects(
  oldStyle: Record<string, any>,
  newStyle: Record<string, any>
): { changed: Record<string, any> | null; removed: string[] } {
  const changed: Record<string, any> = {};
  const removed: string[] = [];
  let hasChanged = false;

  for (const key of Object.keys(newStyle)) {
    if (oldStyle[key] !== newStyle[key]) {
      changed[key] = newStyle[key];
      hasChanged = true;
    }
  }

  for (const key of Object.keys(oldStyle)) {
    if (!(key in newStyle)) {
      removed.push(key);
    }
  }

  return {
    changed: hasChanged ? changed : null,
    removed,
  };
}

const STYLE_OBJECT_PROPS = new Set([
  'contentContainerStyle',
  'hoverStyle',
  'activeStyle',
  'focusStyle',
  'textStyle',
]);

function styleObjectPropChanged(oldVal: unknown, newVal: unknown): boolean {
  if (oldVal === newVal) return false;
  if (!oldVal || !newVal || typeof oldVal !== 'object' || typeof newVal !== 'object') return true;
  const styleDiff = diffStyleObjects(oldVal as Record<string, any>, newVal as Record<string, any>);
  return styleDiff.changed !== null || styleDiff.removed.length > 0;
}

/**
 * Compute a minimal diff between two clean prop objects.
 * Returns the changed props (with partial style diff), removed top-level keys,
 * and removed style keys. Returns null if nothing changed.
 */
function diffCleanProps(
  oldClean: Record<string, any>,
  newClean: Record<string, any>
): { diff: Record<string, any>; removeKeys: string[]; removeStyleKeys: string[] } | null {
  const diff: Record<string, any> = {};
  const removeKeys: string[] = [];
  let removeStyleKeys: string[] = [];
  let hasDiff = false;

  for (const key of Object.keys(newClean)) {
    const oldVal = oldClean[key];
    const newVal = newClean[key];

    if (key === 'style') {
      const styleDiff = diffStyleObjects(oldVal || {}, newVal || {});
      if (styleDiff.changed) {
        diff.style = styleDiff.changed;
        hasDiff = true;
      }
      removeStyleKeys = styleDiff.removed;
      if (removeStyleKeys.length > 0) hasDiff = true;
    } else if (STYLE_OBJECT_PROPS.has(key)) {
      if (styleObjectPropChanged(oldVal, newVal)) {
        diff[key] = newVal;
        hasDiff = true;
      }
    } else if (oldVal !== newVal) {
      diff[key] = newVal;
      hasDiff = true;
    }
  }

  for (const key of Object.keys(oldClean)) {
    if (key === 'style') continue; // handled above
    if (!(key in newClean)) {
      removeKeys.push(key);
      hasDiff = true;
    }
  }

  return hasDiff ? { diff, removeKeys, removeStyleKeys } : null;
}

// ── DefaultEventPriority ────────────────────────────────

const DefaultEventPriority = 0b0000000000000000000000000010000;

// ── Host Config ──────────────────────────────────────────

export const hostConfig: HostConfig<
  string,         // Type
  Props,          // Props
  Container,      // Container
  Instance,       // Instance
  TextInstance,    // TextInstance
  never,          // SuspenseInstance
  never,          // HydratableInstance
  Instance,       // PublicInstance
  {},             // HostContext
  UpdatePayload,  // UpdatePayload
  unknown,        // ChildSet
  number,         // TimeoutHandle
  number           // NoTimeout
> = {
  // ── Feature flags ────────────────────────────────────

  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,

  // ── Context ──────────────────────────────────────────

  getRootHostContext() {
    return {};
  },

  getChildHostContext(_parentContext: {}) {
    return {};
  },

  // ── Instance creation ────────────────────────────────

  createInstance(
    type: string,
    props: Props,
    _rootContainer: Container,
    _hostContext: {},
    internalHandle?: any // React fiber (opaque, but we bend the rules for debugging)
  ): Instance {
    const id = ++nodeIdCounter;
    hostLog(`[hostConfig] createInstance type=${type} id=${id}`);

    // HTML element remapping: <div> → View, <h1> → Text, <img> → Image, etc.
    const resolvedType = HTML_TYPE_MAP[type] || type;
    const resolvedProps = HTML_TYPE_MAP[type] ? resolveHtmlProps(type, props) : props;

    const { clean, handlers } = extractHandlers(resolvedProps);
    if (handlers.onLayout) {
      clean.__hasOnLayout = true;
    }

    const handlerNames = Object.keys(handlers);
    const hasHandlers = handlerNames.length > 0;
    debugLog.log('recon', `createInstance id=${id} type=${resolvedType} handlers=${hasHandlers}`);

    // Extract component debug info from fiber (dev tooling only)
    let debugName: string | undefined;
    let debugSource: { fileName?: string; lineNumber?: number } | undefined;

    if (internalHandle) {
      try {
        // Walk up the fiber tree to find the nearest user component name.
        // Skip primitive wrappers (Box, Text, etc.) and classifier FCs —
        // these are framework internals. The meaningful debugName is the
        // user component that uses them (Band, LayoutStory, etc.).
        const PRIMITIVE_NAMES = new Set([
          'Box', 'Text', 'Image', 'Pressable', 'TextInput', 'ScrollView',
          'Modal', 'Row', 'Col', 'CodeBlock', 'Markdown', 'Window', 'TextEditor',
        ]);
        let fiber = internalHandle;
        while (fiber) {
          if (fiber.type && typeof fiber.type === 'function') {
            const name = fiber.type.displayName || fiber.type.name;
            if (name && !PRIMITIVE_NAMES.has(name) && !(fiber.type as any).__isClassifier) {
              debugName = name;
              break;
            }
          }
          fiber = fiber.return;
        }

        // Walk the fiber chain to find source location (requires JSX dev transform).
        // createInstance runs for host nodes (View, Text, etc.) whose _debugSource
        // points to framework internals (primitives.tsx). We follow _debugOwner up
        // until we find a source file that isn't inside packages/ or node_modules/.
        const isUserFile = (f: string) =>
          f && !f.includes('/packages/') && !f.includes('/node_modules/') && !f.includes('\\packages\\') && !f.includes('\\node_modules\\');

        let src = internalHandle._debugSource;
        if (src && isUserFile(src.fileName)) {
          debugSource = { fileName: src.fileName, lineNumber: src.lineNumber };
        } else {
          // Follow _debugOwner chain to find nearest user-space source
          let owner = internalHandle._debugOwner;
          while (owner) {
            const ownerSrc = owner._debugSource;
            if (ownerSrc && isUserFile(ownerSrc.fileName)) {
              debugSource = { fileName: ownerSrc.fileName, lineNumber: ownerSrc.lineNumber };
              break;
            }
            // Also check the element's own source before moving up
            if (ownerSrc && !debugSource) {
              debugSource = { fileName: ownerSrc.fileName, lineNumber: ownerSrc.lineNumber };
            }
            owner = owner._debugOwner;
          }
        }
      } catch (e) {
        // Silently fail — fiber internals may change between React versions
      }
    }

    // Developer-set debugName prop takes priority over auto-derived fiber name
    if (clean.debugName) {
      debugName = clean.debugName;
    }

    emit({
      op: 'CREATE',
      id,
      type: resolvedType,
      props: clean,
      hasHandlers,
      handlerNames,
      handlerMeta: hasHandlers ? buildHandlerMeta(handlers) : undefined,
      debugName,
      debugSource,
    });

    if (hasHandlers) {
      handlerRegistry.set(id, handlers);
    }

    // Reconciler-managed bridge subscriptions — nodes with __subscribe props
    // get auto-managed subscribe/unsubscribe tied to node lifecycle.
    if (clean.__subscribe) {
      const nodeHandlers = handlers;
      manageSubscription(id, clean.__subscribe, 'onEvent', () => nodeHandlers.onEvent);
    }
    if (clean.__subscribeKey) {
      const nodeHandlers = handlers;
      const comboFilter = clean.combo ? makeComboFilter(clean.combo) : undefined;
      manageSubscription(id, clean.__subscribeKey, 'onKeyDown', () => nodeHandlers.onKeyDown, comboFilter);
    }

    const instance = {
      id,
      type: resolvedType,
      props: clean,
      handlers,
      children: [],
      renderCount: 1,
      parent: null,
      hostWindowId: null,
      debugName,
      debugSource,
    };
    recordChurn('create', instance, { nodes: 1, glyphs: 0 });
    return instance;
  },

  createTextInstance(text: string): TextInstance {
    const id = ++nodeIdCounter;
    hostLog(`[hostConfig] createTextInstance id=${id} text=${JSON.stringify(text)}`);
    emit({ op: 'CREATE_TEXT', id, text });
    return { id, text };
  },

  // ── Tree building (pre-commit) ──────────────────────

  appendInitialChild(parent: Instance, child: Instance | TextInstance) {
    hostLog(`[hostConfig] appendInitialChild parent=${parent.id} child=${child.id}`);
    markParent(parent, child);
    (parent.children as any[]).push(child);
    if (!isInstance(child)) {
      recordChurn('create-text-initial', child, { nodes: 1, glyphs: child.text.length }, textOwnerDetail(child));
    }
    emit({ op: 'APPEND', parentId: parent.id, childId: child.id });
  },

  finalizeInitialChildren() {
    return false;
  },

  // ── Mutations ────────────────────────────────────────

  appendChild(parent: Instance, child: Instance | TextInstance) {
    hostLog(`[hostConfig] appendChild parent=${parent.id} child=${child.id}`);
    markParent(parent, child);
    (parent.children as any[]).push(child);
    if (!isInstance(child)) {
      recordChurn('create-text', child, { nodes: 1, glyphs: child.text.length }, textOwnerDetail(child));
    }
    emit({ op: 'APPEND', parentId: parent.id, childId: child.id });
  },

  appendChildToContainer(container: Container, child: Instance | TextInstance) {
    hostLog(`[hostConfig] appendChildToContainer container=${container.id} child=${child.id}`);
    markParent(null, child);
    rootInstances.push(child as Instance);
    if (!isInstance(child)) {
      recordChurn('create-text-root', child, { nodes: 1, glyphs: child.text.length }, textOwnerDetail(child));
    }
    emit({ op: 'APPEND_TO_ROOT', childId: child.id });
  },

  removeChild(parent: Instance, child: Instance | TextInstance) {
    hostLog(`[hostConfig] removeChild parent=${parent.id} child=${child.id}`);
    debugLog.log('recon', `removeChild parent=${parent.id} child=${child.id}`);
    const idx = (parent.children as any[]).indexOf(child);
    if (idx !== -1) (parent.children as any[]).splice(idx, 1);
    const windowId = isInstance(child)
      ? child.hostWindowId
      : (WINDOW_HOST_TYPES.has(parent.type) ? parent.id : parent.hostWindowId);
    recordChurn('remove', child);
    markParent(null, child);
    emit(commandWithWindow({ op: 'REMOVE', parentId: parent.id, childId: child.id }, windowId));
    cleanupHandlers(child);
  },

  removeChildFromContainer(_container: Container, child: Instance | TextInstance) {
    hostLog(`[hostConfig] removeChildFromContainer child=${child.id}`);
    const idx = rootInstances.indexOf(child as Instance);
    if (idx !== -1) rootInstances.splice(idx, 1);
    const windowId = isInstance(child) ? child.hostWindowId : null;
    recordChurn('remove-root', child);
    markParent(null, child);
    emit(commandWithWindow({ op: 'REMOVE_FROM_ROOT', childId: child.id }, windowId));
    cleanupHandlers(child);
  },

  insertBefore(
    parent: Instance,
    child: Instance | TextInstance,
    before: Instance | TextInstance
  ) {
    hostLog(`[hostConfig] insertBefore parent=${parent.id} child=${child.id} before=${before.id}`);
    const arr = parent.children as any[];
    const idx = arr.indexOf(before);
    if (idx !== -1) {
      arr.splice(idx, 0, child);
    } else {
      arr.push(child);
    }
    markParent(parent, child);
    if (!isInstance(child)) {
      recordChurn('insert-text', child, { nodes: 1, glyphs: child.text.length }, textOwnerDetail(child));
    }
    emit({
      op: 'INSERT_BEFORE',
      parentId: parent.id,
      childId: child.id,
      beforeId: before.id,
    });
  },

  insertInContainerBefore(
    _container: Container,
    child: Instance | TextInstance,
    before: Instance | TextInstance
  ) {
    hostLog(`[hostConfig] insertInContainerBefore child=${child.id} before=${before.id}`);
    const idx = rootInstances.indexOf(before as Instance);
    if (idx !== -1) {
      rootInstances.splice(idx, 0, child as Instance);
    } else {
      rootInstances.push(child as Instance);
    }
    markParent(null, child);
    emit({
      op: 'INSERT_BEFORE_ROOT',
      childId: child.id,
      beforeId: before.id,
    });
  },

  // ── Updates ──────────────────────────────────────────

  prepareUpdate(
    _instance: Instance,
    _type: string,
    oldProps: Props,
    newProps: Props
  ): UpdatePayload {
    // Resolve HTML props before diffing so className→style, src→source, etc. are compared correctly
    const resolvedOld = HTML_TYPE_MAP[_type] ? resolveHtmlProps(_type, oldProps) : oldProps;
    const resolvedNew = HTML_TYPE_MAP[_type] ? resolveHtmlProps(_type, newProps) : newProps;

    const { clean: oldClean, handlers: oldH } = extractHandlers(resolvedOld);
    const { clean: newClean, handlers: newH } = extractHandlers(resolvedNew);
    if (oldH.onLayout) {
      oldClean.__hasOnLayout = true;
    }
    if (newH.onLayout) {
      newClean.__hasOnLayout = true;
    }

    const handlersChanged = !handlersEqual(oldH, newH);
    const propsDiff = diffCleanProps(oldClean, newClean);

    // Closure-identity drift: same handler names but at least one fn replaced.
    // Must still trigger commitUpdate so handlerRegistry picks up the new
    // closure — otherwise Pressables freeze at first-commit handlers and any
    // onPress that closes over state runs the stale capture forever.
    // We return a no-emit sentinel so the bridge stays quiet (the original
    // perf optimization is preserved).
    let closuresChanged = false;
    if (!handlersChanged) {
      for (const k of Object.keys(newH)) {
        if (oldH[k] !== newH[k]) { closuresChanged = true; break; }
      }
    }

    if (!propsDiff && !handlersChanged && !closuresChanged) return null;

    if (!propsDiff && handlersChanged) {
      return { __handlersOnly: true };
    }

    if (!propsDiff && closuresChanged) {
      return { __closuresOnly: true };
    }

    return propsDiff; // { diff, removeKeys, removeStyleKeys }
  },

  commitUpdate(
    instance: Instance,
    updatePayload: UpdatePayload,
    _type: string,
    _oldProps: Props,
    newProps: Props
  ) {
    hostLog(`[hostConfig] commitUpdate id=${instance.id} type=${instance.type}`);
    // Resolve HTML props so the committed state matches what prepareUpdate diffed
    const resolvedNew = HTML_TYPE_MAP[_type] ? resolveHtmlProps(_type, newProps) : newProps;
    const { clean, handlers } = extractHandlers(resolvedNew);
    if (handlers.onLayout) {
      clean.__hasOnLayout = true;
    }

    // Update handler registry
    if (Object.keys(handlers).length > 0) {
      handlerRegistry.set(instance.id, handlers);
    } else {
      handlerRegistry.delete(instance.id);
    }

    instance.handlers = handlers;
    instance.props = clean;
    instance.renderCount = (instance.renderCount || 0) + 1;

    if (updatePayload && !(updatePayload as any).__handlersOnly && !(updatePayload as any).__closuresOnly) {
      const handlerNames = Object.keys(handlers);
      const hasHandlers = handlerNames.length > 0;
      const payload = updatePayload as { diff: Record<string, any>; removeKeys: string[]; removeStyleKeys: string[] };
      const diffKeys = Object.keys(payload.diff);
      debugLog.log('recon', `commitUpdate id=${instance.id} type=${instance.type} diffKeys=[${diffKeys.join(',')}] removeStyle=[${payload.removeStyleKeys.join(',')}]`);
      recordChurn('update', instance, { nodes: 1, glyphs: 0 }, updateChurnDetail(instance, instance.props, clean, diffKeys));

      const cmd: any = {
        op: 'UPDATE',
        id: instance.id,
        props: payload.diff,
        hasHandlers,
        handlerNames,
        handlerMeta: hasHandlers ? buildHandlerMeta(handlers) : undefined,
        renderCount: instance.renderCount,
      };

      if (payload.removeKeys.length > 0) {
        cmd.removeKeys = payload.removeKeys;
      }
      if (payload.removeStyleKeys.length > 0) {
        cmd.removeStyleKeys = payload.removeStyleKeys;
      }

      emit(cmd);
    } else if (updatePayload && (updatePayload as any).__handlersOnly) {
      // Still need to inform Lua about hasHandlers change
      const handlerNames = Object.keys(handlers);
      const hasHandlers = handlerNames.length > 0;
      emit({
        op: 'UPDATE',
        id: instance.id,
        props: {},
        hasHandlers,
        handlerNames,
        handlerMeta: hasHandlers ? buildHandlerMeta(handlers) : undefined,
      });
    }

    // Update reconciler-managed subscriptions when props change
    if (clean.__subscribe !== undefined) {
      manageSubscription(instance.id, clean.__subscribe, 'onEvent', () => {
        const h = handlerRegistry.get(instance.id);
        return h?.onEvent as ((payload: any) => void) | undefined;
      });
    }
    if (clean.__subscribeKey !== undefined) {
      const comboFilter = clean.combo ? makeComboFilter(clean.combo) : undefined;
      manageSubscription(instance.id, clean.__subscribeKey, 'onKeyDown', () => {
        const h = handlerRegistry.get(instance.id);
        return h?.onKeyDown as ((payload: any) => void) | undefined;
      }, comboFilter);
    }
  },

  commitTextUpdate(_textInstance: TextInstance, _oldText: string, newText: string) {
    hostLog(`[hostConfig] commitTextUpdate id=${_textInstance.id} text=${JSON.stringify(newText)}`);
    recordChurn('update-text', _textInstance, { nodes: 1, glyphs: Math.abs(newText.length - _oldText.length) || newText.length }, `${previewText(_oldText)}=>${previewText(newText)} ${textOwnerDetail(_textInstance)}`);
    _textInstance.text = newText;
    emit({ op: 'UPDATE_TEXT', id: _textInstance.id, text: newText });
  },

  // ── Commit lifecycle ─────────────────────────────────

  prepareForCommit() {
    return null;
  },

  resetAfterCommit() {
    hostLog(`[hostConfig] resetAfterCommit`);
    flushChurnTrace();
    const stampStateUpdate = (globalThis as any).__clickLatencyStampStateUpdate;
    if (typeof stampStateUpdate === 'function') {
      try { stampStateUpdate(); } catch {}
    }
    scheduleFlush();
  },

  // ── Misc required methods ────────────────────────────

  shouldSetTextContent() {
    return false;
  },

  getPublicInstance(instance: Instance) {
    return instance;
  },

  preparePortalMount() {},

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,

  getCurrentEventPriority() {
    return DefaultEventPriority;
  },

  getInstanceFromNode() {
    return null;
  },

  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},

  prepareScopeUpdate() {},
  getInstanceFromScope() {
    return null;
  },

  detachDeletedInstance() {},

  clearContainer() {},
};

// ── Internal helpers ─────────────────────────────────────

function cleanupHandlers(node: Instance | TextInstance): void {
  if ('id' in node) {
    handlerRegistry.delete(node.id);
  }
  if ('children' in node) {
    for (const child of (node as Instance).children) {
      cleanupHandlers(child);
    }
  }
  // Also clean up reconciler-managed bridge subscriptions
  cleanupSubscriptionsRecursive(node as any);
}
