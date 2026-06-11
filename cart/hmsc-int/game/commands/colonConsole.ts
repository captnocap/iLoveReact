// game/commands/colonConsole.ts -- Love2D colon-console diagnostics, ported
// onto the V19 command registry. The reference is love2d/lua/console.lua.

import { callHost, hasHost } from '@reactjit/ffi';
import { GAME_TELEMETRY } from '../telemetry';
import type { CommandRegistry, CommandRunResult } from './index';

type ConsoleNode = {
  id?: number | string;
  type?: string;
  tag?: string;
  computed?: { x?: number; y?: number; w?: number; h?: number };
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: ConsoleNode[];
  hasHandlers?: boolean;
  has_handler?: boolean;
  has_text?: boolean;
  has_image?: boolean;
  child_count?: number;
  depth?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

type NodeTable = Record<string, ConsoleNode> | ConsoleNode[];

export type ColonConsoleDiagnostics = {
  tree?: {
    getTree?: () => ConsoleNode | null;
    getNodes?: () => NodeTable | null;
    markDirty?: () => void;
    setStyle?: (id: number, prop: string, value: unknown) => unknown;
    highlight?: (id: number, seconds: number) => void;
  };
  inspector?: {
    getPerfData?: () => { fps?: number; layoutMs?: number; paintMs?: number; nodeCount?: number } | null;
  };
  lua?: {
    eval?: (code: string) => unknown;
  };
  env?: {
    bridge?: string;
    mode?: string;
    loveVersion?: string;
    window?: { width: number; height: number };
    historyCount?: number;
  };
};

export type ColonConsoleContext = {
  __consoleDiagnostics?: ColonConsoleDiagnostics;
};

const COLON_HELP_LINES = [
  'Console commands:',
  '',
  '  Evaluation',
  '  <expr>            Evaluate JavaScript expression',
  '  :lua <expr>       Evaluate Lua expression',
  '',
  '  Introspection',
  '  :tree             Show element tree summary',
  '  :nodes <id>       Inspect a node by ID',
  '  :find <query>     Search nodes (type:Box, text:hello, style:bg)',
  '  :dump <id>        Dump subtree from a node',
  '  :perf             Performance stats',
  '  :env              Runtime environment info',
  '  :highlight <id>   Flash-highlight a node',
  '  :measure <text>   Measure text dimensions',
  '',
  '  Live editing',
  '  :style <id> <prop> <val>  Set node style property',
  '',
  '  Watches',
  '  :watch <expr>     Add JS watch expression',
  '  :watch lua <expr> Add Lua watch expression',
  '  :unwatch <n>      Remove watch by index',
  '  :watches          List all watches',
  '',
  '  Macros',
  '  :record <name>    Start recording macro',
  '  :stop             Stop recording',
  '  :play <name>      Play a macro',
  '  :macros           List saved macros',
  '',
  '  Templates',
  '  :template <name>  Show a boilerplate template',
  '  :templates        List available templates',
  '',
  '  Debug logging',
  '  :log              Show all channels and their on/off state',
  '  :log <channel>    Toggle a channel (layout, tree, events, paint, ...)',
  '  :log <ch> on|off  Explicit on/off',
  '  :log all          Enable all channels',
  '  :log none         Disable all channels',
  '  :log ch1 ch2      Toggle multiple channels at once',
  '',
  '  General',
  '  :clear            Clear output',
  '  :help             Show this help',
  '',
  'Keys: Tab = autocomplete, Up/Down = history, Ctrl+L = clear, Ctrl+W = delete word, Ctrl+U = clear line',
];

const LOG_CHANNEL_ALIASES: Record<string, string> = {
  layout: 'frame',
  tree: 'pools',
  events: 'tick',
  paint: 'draw',
};

function serialize(value: unknown, depth = 0): string {
  if (depth > 3) return '{...}';
  if (typeof value === 'string') return `"${value.length > 200 ? `${value.slice(0, 197)}...` : value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return 'nil';
  if (Array.isArray(value)) {
    const parts = value.slice(0, 10).map((item) => serialize(item, depth + 1));
    if (value.length > 10) parts.push('...');
    return `[ ${parts.join(', ')} ]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const parts = entries.slice(0, 10).map(([k, v]) => `${k}: ${serialize(v, depth + 1)}`);
    if (entries.length > 10) parts.push('...');
    return `{ ${parts.join(', ')} }`;
  }
  return String(value);
}

function coerceStyleValue(raw: string): unknown {
  const num = Number(raw);
  if (Number.isFinite(num)) return num;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'nil' || raw === 'none') return undefined;
  return raw;
}

function childrenOf(node: ConsoleNode): ConsoleNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function nodeId(node: ConsoleNode, fallback?: number): string {
  return String(node.id ?? fallback ?? '?');
}

function nodeType(node: ConsoleNode): string {
  return String(node.type ?? node.tag ?? '?');
}

function computedOf(node: ConsoleNode): { x: number; y: number; w: number; h: number } | null {
  const c = node.computed ?? node;
  const x = Number(c.x);
  const y = Number(c.y);
  const w = Number(c.w);
  const h = Number(c.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

function countNodes(node: ConsoleNode | null): number {
  if (!node) return 0;
  let count = 1;
  for (const child of childrenOf(node)) count += countNodes(child);
  return count;
}

function walkNodes(node: ConsoleNode | null, fn: (node: ConsoleNode, index: number) => void, next = { i: 0 }): void {
  if (!node) return;
  fn(node, next.i);
  next.i += 1;
  for (const child of childrenOf(node)) walkNodes(child, fn, next);
}

function readTree(ctx: ColonConsoleContext): ConsoleNode | null {
  const injected = ctx.__consoleDiagnostics?.tree?.getTree?.();
  if (injected) return injected;
  if (!hasHost('__tel_node')) return null;
  return (callHost<ConsoleNode | null>('__tel_node', null, 0) ?? null);
}

function readNodes(ctx: ColonConsoleContext): NodeTable | null {
  const injected = ctx.__consoleDiagnostics?.tree?.getNodes?.();
  if (injected) return injected;
  if (!hasHost('__tel_node_count') || !hasHost('__tel_node')) return null;
  const count = Math.max(0, Math.floor(callHost<number>('__tel_node_count', 0)));
  const nodes: ConsoleNode[] = [];
  for (let i = 0; i < Math.min(count, 200); i += 1) {
    const node = callHost<ConsoleNode | null>('__tel_node', null, i);
    if (node) nodes[i] = { ...node, id: i };
  }
  return nodes;
}

function nodeFromTable(nodes: NodeTable | null, id: number): ConsoleNode | null {
  if (!nodes) return null;
  return Array.isArray(nodes) ? (nodes[id] ?? null) : (nodes[String(id)] ?? null);
}

function dumpNodeLines(node: ConsoleNode | null): string[] {
  if (!node) return ['Node not found'];
  const lines = [`${nodeType(node)}  #${nodeId(node)}`];
  const c = computedOf(node);
  if (c) lines.push(`  position: x=${Math.floor(c.x)} y=${Math.floor(c.y)} w=${Math.floor(c.w)} h=${Math.floor(c.h)}`);
  for (const [k, v] of Object.entries(node.props ?? {})) {
    if (k !== 'style') lines.push(`  prop.${k}: ${serialize(v)}`);
  }
  for (const [k, v] of Object.entries(node.style ?? {})) lines.push(`  style.${k}: ${serialize(v)}`);
  const childCount = childrenOf(node).length || Number(node.child_count) || 0;
  if (childCount > 0) lines.push(`  children: ${childCount}`);
  if (node.hasHandlers || node.has_handler) lines.push('  has event handlers');
  return lines;
}

function readNodeStyle(id: number, node: ConsoleNode): Record<string, unknown> {
  if (node.style) return node.style;
  if (!hasHost('__tel_node_style')) return {};
  return callHost<Record<string, unknown>>('__tel_node_style', {}, id) ?? {};
}

function textOf(node: ConsoleNode): string {
  return String((node.props?.text ?? '') || '');
}

function metricFromText(text: string, fontSize: number): { w: number; h: number } {
  const averageGlyphWidth = 0.58;
  return {
    w: Math.ceil(text.length * fontSize * averageGlyphWidth),
    h: Math.ceil(fontSize * 1.2),
  };
}

function evalLua(ctx: ColonConsoleContext, code: string): string[] {
  const injected = ctx.__consoleDiagnostics?.lua?.eval;
  if (injected) {
    try {
      const result = injected(code);
      return result == null ? [] : [serialize(result)];
    } catch (error: any) {
      return [`Runtime error: ${error?.message ?? String(error)}`];
    }
  }
  const g = globalThis as any;
  if (typeof g.__lua_available === 'function' && g.__lua_available() === 1 && typeof g.__lua_start === 'function' && typeof g.__lua_eval === 'function') {
    const started = g.__lua_start();
    if (started < 0) return ['Lua eval not available'];
    const written = g.__lua_eval(code);
    return [`lua eval queued (${written} bytes)`];
  }
  return ['Lua eval not available'];
}

function logChannelName(raw: string): string | null {
  const alias = LOG_CHANNEL_ALIASES[raw] ?? raw;
  return GAME_TELEMETRY.isDiagnosticChannel(alias) ? alias : null;
}

export function defineColonConsoleCommands<Ctx extends ColonConsoleContext>(registry: CommandRegistry<Ctx>): void {
  const define = registry.define;

  define({ name: ':help', usage: ':help', summary: 'Show all colon-console commands.', run: () => COLON_HELP_LINES });

  define({ name: ':clear', usage: ':clear', summary: 'Clear console output.', run: (): CommandRunResult => ({ clearTranscript: true }) });

  define({
    name: ':tree',
    usage: ':tree',
    summary: 'Show element tree summary.',
    run: (ctx) => {
      const root = readTree(ctx);
      if (!root) {
        const nodes = GAME_TELEMETRY.readSnapshot('nodes');
        if (!nodes) return ['Tree module not available'];
        return [`Root: (host summary)  |  ${Number(nodes.total) || 0} nodes`];
      }
      const c = computedOf(root);
      const childCount = childrenOf(root).length;
      const lines = [
        c
          ? `Root: ${Math.floor(c.w)}x${Math.floor(c.h)}  |  ${countNodes(root)} nodes  |  ${childCount} children`
          : `Root: (no layout)  |  ${countNodes(root)} nodes`,
      ];
      childrenOf(root).slice(0, 10).forEach((child, i) => {
        const cc = computedOf(child);
        const dims = cc ? `${Math.floor(cc.w)}x${Math.floor(cc.h)}` : '?';
        lines.push(`  [${i + 1}] ${nodeType(child)} #${nodeId(child)}  ${dims}`);
      });
      if (childCount > 10) lines.push(`  ... +${childCount - 10} more`);
      return lines;
    },
  });

  define({
    name: ':nodes',
    usage: ':nodes <id>',
    summary: 'Inspect a node by ID.',
    run: (ctx, args) => {
      const id = Number(args[0]);
      if (!Number.isFinite(id)) throw new Error('Usage: :nodes <id>');
      const nodes = readNodes(ctx);
      if (!nodes) return ['Tree module not available'];
      return dumpNodeLines(nodeFromTable(nodes, id));
    },
  });

  define({
    name: ':perf',
    usage: ':perf',
    summary: 'Performance stats.',
    run: (ctx) => {
      const perf = ctx.__consoleDiagnostics?.inspector?.getPerfData?.();
      if (perf) {
        return [`FPS: ${Math.floor(Number(perf.fps) || 0)}  |  Layout: ${(Number(perf.layoutMs) || 0).toFixed(1)}ms  |  Paint: ${(Number(perf.paintMs) || 0).toFixed(1)}ms  |  Nodes: ${Math.floor(Number(perf.nodeCount) || 0)}`];
      }
      const frame = GAME_TELEMETRY.readFrame();
      if (!frame) return ['Performance data not available'];
      return [`FPS: ${Math.floor(frame.fps)}  |  Layout: ${(frame.layoutUs / 1000).toFixed(1)}ms  |  Paint: ${(frame.paintUs / 1000).toFixed(1)}ms  |  Nodes: ${GAME_TELEMETRY.readScalar('nodeCount')}`];
    },
  });

  define({
    name: ':env',
    usage: ':env',
    summary: 'Show bridge/mode/runtime info.',
    run: (ctx) => {
      const env = ctx.__consoleDiagnostics?.env;
      const system = GAME_TELEMETRY.readSnapshot('system');
      const w = (env?.window?.width ?? Number(system?.window_w)) || 0;
      const h = (env?.window?.height ?? Number(system?.window_h)) || 0;
      return [
        'Runtime environment:',
        `  Bridge: ${env?.bridge ?? 'V8 (native)'}`,
        `  Mode: ${env?.mode ?? 'unknown'}`,
        `  Love2D: ${env?.loveVersion ?? 'n/a'}`,
        `  Window: ${Math.floor(w)}x${Math.floor(h)}`,
        `  Console output: ${env?.historyCount ?? 0} lines`,
        '  History: session-owned',
        '  Watches: 0 active',
        '  Macros: 0 saved',
      ];
    },
  });

  define({
    name: ':find',
    usage: ':find <query>',
    summary: 'Search nodes by type, text, style, id, or handler.',
    run: (ctx, args) => {
      const query = args.join(' ').trim();
      if (!query) throw new Error('Usage: :find <query>');
      const root = readTree(ctx);
      const nodes = readNodes(ctx);
      if (!root && !nodes) return ['Tree module not available'];
      const matches: Array<{ node: ConsoleNode; index: number }> = [];
      const [fieldRaw, valueRaw] = query.includes(':') ? query.split(/:(.*)/s, 2) : ['', query];
      const field = fieldRaw || '';
      const value = valueRaw.toLowerCase();
      const visit = (node: ConsoleNode, index: number) => {
        if (!field || field === 'type') {
          if (nodeType(node).toLowerCase().includes(value)) matches.push({ node, index });
        } else if (field === 'text') {
          if (textOf(node).toLowerCase().includes(value)) matches.push({ node, index });
        } else if (field === 'style') {
          for (const key of Object.keys(readNodeStyle(index, node))) {
            if (key.toLowerCase().includes(value)) {
              matches.push({ node, index });
              break;
            }
          }
        } else if (field === 'id') {
          const id = Number(valueRaw);
          const found = nodeFromTable(nodes, id);
          if (found) matches.push({ node: found, index: id });
          return;
        } else if (field === 'handler' || field === 'handlers') {
          if (node.hasHandlers || node.has_handler) matches.push({ node, index });
        }
      };
      if (field && !['type', 'text', 'style', 'id', 'handler', 'handlers'].includes(field)) {
        return [`Unknown search field: ${field}`, 'Fields: type, text, style, id, handler'];
      }
      if (root) walkNodes(root, visit);
      else if (Array.isArray(nodes)) nodes.forEach((node, index) => node && visit(node, index));
      else if (nodes) Object.entries(nodes).forEach(([key, node]) => visit(node, Number(key)));
      const lines = [`Found ${matches.length} nodes matching '${query}':`];
      matches.slice(0, 20).forEach(({ node, index }) => {
        const c = computedOf(node);
        const dims = c ? `(${Math.floor(c.x)},${Math.floor(c.y)} ${Math.floor(c.w)}x${Math.floor(c.h)})` : '';
        const text = textOf(node);
        const snip = text ? ` "${text.length > 20 ? `${text.slice(0, 17)}...` : text}"` : '';
        lines.push(`  #${nodeId(node, index)} ${nodeType(node)} ${dims}${snip}`);
      });
      if (matches.length > 20) lines.push(`  ... +${matches.length - 20} more`);
      return lines;
    },
  });

  define({
    name: ':dump',
    usage: ':dump <id>',
    summary: 'Dump subtree from a node.',
    run: (ctx, args) => {
      const id = Number(args[0]);
      if (!Number.isFinite(id)) throw new Error('Usage: :dump <id>');
      const node = nodeFromTable(readNodes(ctx), id);
      if (!node) throw new Error(`Node not found: ${args[0]}`);
      const lines: string[] = [];
      const recur = (current: ConsoleNode, depth: number) => {
        if (depth > 8) {
          lines.push(`${'  '.repeat(depth)}...`);
          return;
        }
        const c = computedOf(current);
        const dims = c ? `${Math.floor(c.w)}x${Math.floor(c.h)}` : '?';
        const text = textOf(current);
        const snip = text ? (text.length > 30 ? ` "${text.slice(0, 27)}..."` : ` "${text}"`) : '';
        lines.push(`${'  '.repeat(depth)}${nodeType(current)} #${nodeId(current)}  ${dims}${snip}`);
        for (const child of childrenOf(current)) recur(child, depth + 1);
      };
      recur(node, 0);
      return lines;
    },
  });

  define({
    name: ':style',
    usage: ':style <id> <property> <value>',
    summary: 'Live-edit node style.',
    run: (ctx, args) => {
      const id = Number(args[0]);
      const prop = args[1];
      const raw = args.slice(2).join(' ');
      if (!Number.isFinite(id) || !prop || raw === '') {
        return ['Usage: :style <id> <property> <value>', '  Example: :style 5 backgroundColor #ff0000', '  Example: :style 5 width 200', '  Example: :style 5 flexGrow 1'];
      }
      const value = coerceStyleValue(raw);
      const node = nodeFromTable(readNodes(ctx), id);
      if (!node) throw new Error(`Node not found: ${id}`);
      const oldValue = readNodeStyle(id, node)[prop];
      const setter = ctx.__consoleDiagnostics?.tree?.setStyle;
      if (!setter) return ['Style editing not available'];
      setter(id, prop, value);
      ctx.__consoleDiagnostics?.tree?.markDirty?.();
      return [`Set #${id} style.${prop}: ${serialize(oldValue)} -> ${serialize(value)}`];
    },
  });

  define({
    name: ':highlight',
    usage: ':highlight <id>',
    summary: 'Flash-highlight a node by ID.',
    run: (ctx, args) => {
      const id = Number(args[0]);
      if (!Number.isFinite(id)) throw new Error('Usage: :highlight <id>');
      const node = nodeFromTable(readNodes(ctx), id);
      if (!node) throw new Error(`Node not found: ${args[0]}`);
      ctx.__consoleDiagnostics?.tree?.highlight?.(id, 1.5);
      return [`Highlighting #${id} for 1.5s`];
    },
  });

  define({
    name: ':measure',
    usage: ':measure <text> [fontSize]',
    summary: 'Measure text dimensions.',
    run: (_ctx, args) => {
      if (args.length === 0) throw new Error('Usage: :measure <text> [fontSize]');
      const maybeSize = Number(args[args.length - 1]);
      const hasSize = Number.isFinite(maybeSize);
      const fontSize = hasSize ? maybeSize : 14;
      const text = (hasSize ? args.slice(0, -1) : args).join(' ');
      const m = metricFromText(text, fontSize);
      return [`Text: "${text}" at ${fontSize}px -> ${m.w}x${m.h}`];
    },
  });

  define({
    name: ':lua',
    usage: ':lua <expr>',
    summary: 'Evaluate Lua expression.',
    run: (ctx, args) => {
      const code = args.join(' ').trim();
      if (!code) throw new Error('Usage: :lua <expr>');
      return evalLua(ctx, code);
    },
  });

  define({
    name: ':log',
    usage: ':log [channel|all|none] [on|off]',
    summary: 'Show or toggle debug log channels.',
    run: (_ctx, args) => {
      if (args.length === 0) {
        return [
          'Debug log channels:',
          '',
          ...GAME_TELEMETRY.channels
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => `  ${c.name.padEnd(10)} ${GAME_TELEMETRY.diagnosticChannelEnabled(c.name) ? 'ON' : 'OFF'}  ${c.purpose}`),
          '',
          'Usage: :log <channel> | :log all | :log none | :log ch1 ch2',
          'Env var: REACTJIT_DEBUG=tree,layout love love',
        ];
      }
      const first = args[0];
      if (first === 'all' || first === 'none') {
        const enabled = first === 'all';
        for (const spec of GAME_TELEMETRY.channels) GAME_TELEMETRY.setDiagnosticChannel(spec.name, enabled);
        return [enabled ? 'All channels enabled' : 'All channels disabled'];
      }
      const directive = args.length >= 2 && (args[args.length - 1] === 'on' || args[args.length - 1] === 'off') ? args[args.length - 1] : null;
      const names = directive ? args.slice(0, -1) : args;
      const lines: string[] = [];
      for (const raw of names) {
        const name = logChannelName(raw);
        if (!name) {
          lines.push(`  Unknown channel: ${raw}`);
          continue;
        }
        if (directive === 'on') GAME_TELEMETRY.setDiagnosticChannel(name as any, true);
        else if (directive === 'off') GAME_TELEMETRY.setDiagnosticChannel(name as any, false);
        else GAME_TELEMETRY.setDiagnosticChannel(name as any, !GAME_TELEMETRY.diagnosticChannelEnabled(name as any));
        const spec = GAME_TELEMETRY.channels.find((c) => c.name === name)!;
        lines.push(`  ${raw}: ${GAME_TELEMETRY.diagnosticChannelEnabled(name as any) ? 'ON' : 'OFF'}  (${spec.purpose})`);
      }
      return lines;
    },
  });
}
