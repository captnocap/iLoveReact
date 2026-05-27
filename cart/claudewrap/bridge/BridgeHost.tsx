// BridgeHost — invisible component that binds the OpenAI-compatible
// HTTP server. Mounted as a sibling in App.tsx so the bridge is alive
// for the lifetime of the cart.
//
// Architectural note on the in-VM claude:
//
// The source `cart/claude_openai_bridge_tui.tsx` ran claude directly
// on the host through a launcher with --mcp-config pointing at /mcp.
// In claudewrap the live <Terminal> runs scripts/claude-ss (firecracker
// boot), so the in-VM claude does NOT have the bridge's MCP config
// wired into its settings yet. The bridge still serves:
//
//   - /v1/chat/completions via TRANSCRIPT SCRAPING (works without MCP).
//     Claude inside the VM sees the directive in its prompt context;
//     its response lands in the JSONL transcript file the host can
//     read.
//
//   - /mcp routes preserved for the case where an external claude
//     IS configured to dial in. Phase 5+ work: inject the bridge MCP
//     config into the firecracker worker-minimal recipe so the in-VM
//     claude calls bridge.respond/bridge.call_tool.
//
// Every other behaviour from the source is preserved verbatim.

import * as React from 'react';
import { useHost } from '../../../runtime/hooks/useHost';
import { useFileWatch } from '../../../runtime/hooks/useFileWatch';
import { callHost } from '../../../runtime/ffi';
import { writeFile, readFile } from '../../../runtime/hooks/fs';
import { ensureClaudeLauncher, isBridgeModel, type BridgeModel } from './launcher';
import { SessionPool } from './session-pool';
import {
  MCP_PROTOCOL_VERSION,
  RESPOND_TOOL,
  CALL_TOOL_TOOL,
  mcpResult,
  mcpErr,
  composeDirective,
} from './mcp';
import {
  pickActiveSession,
  snapshotSessionPings,
  latestTranscript,
  findClaudeTranscriptReply,
  transcriptDiagnostics,
  describeCandidates,
  parseAssistantTurn,
} from './transcript';
import { claudeProjectDir, cwdGet, envGet, nowSeconds, randHex, runtimeDir } from './common';
import { pushTrace } from './trace-store';
import type { BridgeTrace, PendingCompletion, PendingToolCall } from './types';

const MODEL_ID = 'live-claude-code';
const TRANSCRIPT_POLL_MS = 250;

// Models the headless pool exposes. Each selects WHERE claude runs; the
// pool spawns one process per thread of whichever model the request
// names. (Attached/claudewrap mode ignores this and serves its single
// visible <Terminal> claude under the legacy MODEL_ID.)
const POOL_MODELS: BridgeModel[] = ['disk-claude', 'firecracker-claude'];
const DEFAULT_POOL_MODEL: BridgeModel = 'disk-claude';
// Tear down a thread's claude after this much inactivity so abandoned
// threads don't leave processes running forever.
const POOL_IDLE_EVICT_MS = 30 * 60 * 1000;
const POOL_EVICT_SWEEP_MS = 60 * 1000;
const BRIDGE_TMP_DIR = '/tmp/reactjit-bridge';
// A freshly-spawned claude may not be ready for the first paste yet. If
// our user message hasn't landed in the transcript after this long, the
// paste was likely dropped — re-paste (up to POOL_MAX_PASTES). Never
// re-paste once the user entry IS present (that would duplicate input).
const POOL_REPASTE_GRACE_MS = 4000;
const POOL_MAX_PASTES = 3;
// Hard ceiling on a turn so the HTTP request always completes — without
// it a dropped prompt or a wedged claude would hang forever.
const POOL_TURN_TIMEOUT_MS = 180_000;

// Per-thread state for a single in-flight turn. Keyed by `${chatId}-
// ${turnId}` in the pool path so concurrent threads never clobber each
// other's MCP buffer / resolvers (the legacy attached path keeps using
// the singleton refs below).
interface PooledTurn {
  chatId: string;
  turnId: string;
  endMarker: string;
  sid: string;
  pipe: string;
  tools: any[];
  system: string;
  mcpBuffer: string[];
  pending: PendingCompletion | null;
  resolveText: ((text: string) => void) | null;
  resolveTools: ((toolCalls: any[]) => void) | null;
  trace: BridgeTrace;
}

// The bridge-protocol-inject.sh UserPromptSubmit hook reads a per-sid
// marker so each concurrent claude picks up ITS OWN turn's directive.
function writeTurnMarker(sid: string, directiveText: string, chatId: string, turnId: string, endMarker: string): void {
  try {
    writeFile(`${BRIDGE_TMP_DIR}/active-turn-${sid}.json`, JSON.stringify({
      written_at_ms: Date.now(),
      sid,
      chat_id: chatId,
      turn_id: turnId,
      end_marker: endMarker,
      directive_text: directiveText,
    }));
  } catch {
    // Best-effort: claude still answers without the directive, the reply
    // just lands via transcript end_turn rather than bridge.respond.
  }
}

const ROUTES = [
  { path: '/', kind: 'handler' as const },
  { path: '/v1/models', kind: 'handler' as const },
  { path: '/v1/chat/completions', kind: 'handler' as const },
  { path: '/rows', kind: 'handler' as const },
  { path: '/state', kind: 'handler' as const },
  { path: '/export', kind: 'handler' as const },
  { path: '/transcripts', kind: 'handler' as const },
  { path: '/send', kind: 'handler' as const },
  { path: '/mcp', kind: 'handler' as const },
  // Bridge directive endpoint — the in-VM UserPromptSubmit hook
  // curls this every prompt and feeds the response back as
  // hookSpecificOutput.additionalContext. Lets us inject chat_id/
  // turn_id/endMarker into claude's context WITHOUT pasting them
  // into the user-visible message body.
  { path: '/directive', kind: 'handler' as const },
];

// ── Direct vterm/semantic readers ──────────────────────────────────
// The original bridge wrapped these in useTerminal's `sem` API. In
// claudewrap the Terminal already mounts via App.tsx, so we go to
// the host fns directly.

// All host fns take a session name as the first arg under the per-pipe
// vterm refactor. The cart's <Terminal session="default"> pins the live
// session to DEFAULT_SESSION ("default"); we pass that name explicitly
// where the per-session API is exposed.
//
// Row reads go through __sem_vterm_rows / __sem_row_text rather than
// __vterm_rows / __vterm_row_text because the latter pair doesn't
// exist — v8_bindings_vterm.zig only registers __vterm_get_row which
// returns ENCODED cells (\x1e-separated, \x1f-delimited fields). The
// __sem_* readers wrap vterm_mod.getRowText which returns plain text
// from the DEFAULT_SESSION pipe. Same buffer; cleaner shape for
// substring matching the [END_*] marker.
const SESSION = 'default';

function vtermRows(): number {
  return callHost<number>('__sem_vterm_rows', 0) ?? 0;
}

function rowText(row: number): string {
  return callHost<string>('__sem_row_text', '', row) ?? '';
}

function semState(): any {
  return callHost<any>('__sem_state', null, SESSION);
}

function semExport(): any {
  return callHost<any>('__sem_export', null, SESSION);
}

function semBuildGraph(): void {
  callHost('__sem_build_graph', undefined as any, SESSION);
}

function writePty(data: string): void {
  callHost('__vterm_write', undefined as any, SESSION, data);
}

// Pool path: write into a specific thread's pipe rather than the shared
// default session.
function writePtyTo(pipe: string, data: string): void {
  callHost('__vterm_write', undefined as any, pipe, data);
}

// Paste a user prompt as a bracketed-paste block + Enter (matches the
// legacy writePty prompt format).
function pastePrompt(pipe: string, prompt: string): void {
  writePtyTo(pipe, `\x1b[200~${prompt}\x1b[201~\r`);
}

function allRowsText(): string[] {
  const n = vtermRows();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(rowText(i));
  return out;
}

function terminalSessionPrefix(): string {
  const rows = allRowsText();
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i].match(/(?:^|\s)([0-9a-f]{4})\s+·\s+/i);
    if (m) return m[1].toLowerCase();
  }
  return '';
}

// ── Request → prompt extraction ────────────────────────────────────

function messagePartText(part: any): string {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'text') return String(part.text ?? '');
  return '';
}

interface ExtractedPrompt {
  system: string;
  user: string;
}

function extractPrompt(body: any): ExtractedPrompt {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const system = messages
    .filter((m: any) => m?.role === 'system')
    .map((m: any) => typeof m.content === 'string' ? m.content : messagePartText(m.content))
    .filter(Boolean)
    .join('\n\n');
  const lastUser = [...messages].reverse().find((m: any) => m?.role === 'user');
  const userContent = lastUser?.content;
  const user = Array.isArray(userContent)
    ? userContent.map(messagePartText).filter(Boolean).join('\n')
    : String(userContent ?? '');
  return { system, user };
}

// ── Response shaping ────────────────────────────────────────────────

// `externalSessionId` carries claude's self-assigned sid back to the
// caller (the RETURN path). The thread persists it and sends it as the
// resume key (`user`) on its next turn, so the same claude process keeps
// serving that thread. Surfaced both top-level and per-chunk so the
// openai_compat worker can read it from streaming or non-streaming.
function completionResponse(content: string, model = MODEL_ID, trace?: BridgeTrace, externalSessionId?: string): string {
  return JSON.stringify({
    id: `chatcmpl-claude-pty-${Date.now()}`,
    object: 'chat.completion',
    created: nowSeconds(),
    model,
    external_session_id: externalSessionId,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    bridge_trace: trace,
  });
}

function streamingResponseBody(content: string, model = MODEL_ID, externalSessionId?: string): string {
  const id = `chatcmpl-claude-pty-${Date.now()}`;
  const created = nowSeconds();
  const chunk = (delta: any, finish: string | null) => JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    external_session_id: externalSessionId,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  return (
    `data: ${chunk({ role: 'assistant', content }, null)}\n\n` +
    `data: ${chunk({}, 'stop')}\n\n` +
    `data: [DONE]\n\n`
  );
}

function errorResponse(message: string): string {
  return JSON.stringify({ error: { message, type: 'claude_pty_bridge_error' } });
}

// ── Component ──────────────────────────────────────────────────────

export interface BridgeHostProps {
  /** Port the OpenAI-compatible HTTP server binds. In claudewrap this
   *  comes from the settings store; tui_app passes a fixed port. */
  port: number;
  /** Headless mode. When set, BridgeHost spawns this shell INTO the
   *  vterm session itself (via __vterm_open) and pumps the PTY on a
   *  timer — no visible <Terminal> required. claudewrap leaves this
   *  unset because its <Terminal session="default"> already owns the
   *  pipe; tui_app passes the host claude launcher so an interactive
   *  claude runs entirely behind the scenes. Both modes drive the same
   *  DEFAULT_SESSION pipe the readers below address. */
  spawnShell?: string;
  /** PTY geometry for the self-spawned shell. Ignored when spawnShell
   *  is unset (the <Terminal> owns geometry in attached mode). */
  rows?: number;
  cols?: number;
}

export function BridgeHost({ port, spawnShell, rows = 40, cols = 120 }: BridgeHostProps) {
  // Headless = tui_app (we own the processes via the pool). Attached =
  // claudewrap (a visible <Terminal session="default"> owns one claude;
  // we never spawn).
  const headless = !!spawnShell;

  // The per-thread process pool. Headless only. Each open thread holds
  // its own claude process keyed by claude's self-assigned sid.
  const poolRef = React.useRef<SessionPool | null>(null);
  if (headless && !poolRef.current) {
    poolRef.current = new SessionPool({ port, rows, cols });
  }
  // In-flight pooled turns, keyed by `${chatId}-${turnId}`, plus a
  // sid → turnKey index so MCP calls (which carry chat_id/turn_id) and
  // the /directive lookup can find the owning turn.
  const turnsRef = React.useRef<Map<string, PooledTurn>>(new Map());

  React.useEffect(() => {
    ensureClaudeLauncher(port);
    if (!headless) return;
    const pool = poolRef.current!;
    pool.start();
    const evict = setInterval(() => pool.evictIdle(POOL_IDLE_EVICT_MS), POOL_EVICT_SWEEP_MS);
    return () => {
      clearInterval(evict);
      // Tear down every thread's claude. closePipe → Pty.closePty closes
      // the master fd, SIGTERMs the spawned claude, spin-waits, SIGKILLs
      // if stubborn, and reaps it — so no headless claude outlives the
      // bridge that owns it.
      pool.stop();
    };
  }, [port, headless]);

  // Cross-handler refs — same shape the source bridge used. These back
  // the LEGACY (attached) single-turn path; the pooled path uses the
  // per-turn PooledTurn records in turnsRef instead.
  const queueRef = React.useRef(Promise.resolve());
  const pendingRef = React.useRef<PendingCompletion | null>(null);
  const mcpBufferRef = React.useRef<string[]>([]);
  const httpResolveRef = React.useRef<((text: string) => void) | null>(null);
  const activeTraceRef = React.useRef<BridgeTrace | null>(null);
  const activeChatIdRef = React.useRef<string>('');
  const activeTurnIdRef = React.useRef<string>('');
  const activeToolsRef = React.useRef<any[]>([]);
  // System content from the current request's messages[]. Routed to
  // the in-VM claude via the UserPromptSubmit hook's additionalContext
  // (NOT pasted into the user-visible PTY paste). Keeps the visible
  // chat clean while preserving the system context's effect.
  const activeSystemRef = React.useRef<string>('');
  const pendingToolCallsRef = React.useRef<Map<string, PendingToolCall>>(new Map());
  const toolInvokeResolveRef = React.useRef<((toolCalls: any[]) => void) | null>(null);

  // Resolve any in-flight turn whose transcript has reached end_turn.
  // Pooled turns each carry their own sid-locked pending; the legacy
  // path has the single pendingRef.
  const resolvePendingFromTranscript = React.useCallback(() => {
    let resolvedAny = false;
    for (const [key, turn] of turnsRef.current) {
      if (!turn.pending || !turn.resolveText) continue;
      const result = findClaudeTranscriptReply(turn.pending);
      if (!result.complete) continue;
      // Prefer claude's clean bridge.respond text when it used MCP;
      // fall back to the transcript text otherwise.
      const buffered = turn.mcpBuffer.join('\n\n').trim();
      const text = buffered || result.text || '(end_turn with no text)';
      turn.pending = null;
      const resolve = turn.resolveText;
      turn.resolveText = null;
      turnsRef.current.delete(key);
      resolve(text);
      resolvedAny = true;
    }
    const pending = pendingRef.current;
    if (pending) {
      const result = findClaudeTranscriptReply(pending);
      if (result.complete) {
        pendingRef.current = null;
        pending.resolve(result.text || '(end_turn with no text)');
        resolvedAny = true;
      }
    }
    return resolvedAny;
  }, []);

  const watchDir = React.useMemo(() => claudeProjectDir(), []);
  useFileWatch(watchDir, () => {
    resolvePendingFromTranscript();
  }, { recursive: true, intervalMs: 100, pattern: '*.jsonl' });

  useHost({
    kind: 'http',
    port,
    routes: ROUTES,
    onRequest: (req, res) => {
      try {
        if (req.method === 'GET' && req.path === '/') {
          res.send(200, 'application/json', JSON.stringify({
            bridge: 'claudewrap',
            model: MODEL_ID,
            endpoints: ROUTES.map((r) => r.path),
          }, null, 2));
          return;
        }
        if (req.method === 'GET' && req.path === '/v1/models') {
          const data = headless
            ? POOL_MODELS.map((id) => ({ id, object: 'model', created: nowSeconds(), owned_by: 'local-pty' }))
            : [{ id: MODEL_ID, object: 'model', created: nowSeconds(), owned_by: 'local-pty' }];
          res.send(200, 'application/json', JSON.stringify({ object: 'list', data }));
          return;
        }
        if (req.method === 'GET' && req.path === '/rows') {
          res.send(200, 'text/plain', allRowsText().join('\n'));
          return;
        }
        if (req.method === 'GET' && req.path === '/state') {
          res.send(200, 'application/json', JSON.stringify(semState() ?? {}, null, 2));
          return;
        }
        if (req.method === 'GET' && req.path === '/export') {
          semBuildGraph();
          res.send(200, 'application/json', JSON.stringify(semExport() ?? {}, null, 2));
          return;
        }
        if (req.method === 'GET' && req.path === '/transcripts') {
          res.send(200, 'application/json', JSON.stringify(transcriptDiagnostics(), null, 2));
          return;
        }
        if (req.method === 'POST' && req.path === '/send') {
          writePty(req.body);
          res.send(200, 'application/json', JSON.stringify({ wrote: req.body.length }));
          return;
        }
        if (req.method === 'POST' && req.path === '/mcp') {
          handleMcp(req, res);
          return;
        }
        if (req.method === 'POST' && req.path === '/v1/chat/completions') {
          handleChatCompletions(req, res);
          return;
        }
        if (req.method === 'GET' && req.path === '/directive') {
          // VM-side UserPromptSubmit hook curls this; whatever JSON we
          // return is the hook's stdout, which claude interprets per
          // its hookSpecificOutput contract. Empty object = no-op.
          const chatId = activeChatIdRef.current;
          const turnId = activeTurnIdRef.current;
          if (!chatId || !turnId) {
            res.send(200, 'application/json', '{}');
            return;
          }
          const directive = composeDirective({
            chatId, turnId,
            endMarker: `[END_${chatId}-${turnId}]`,
            tools: activeToolsRef.current,
            systemContext: activeSystemRef.current,
          });
          res.send(200, 'application/json', JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              additionalContext: directive,
            },
          }));
          return;
        }
        res.send(404, 'text/plain', `no route: ${req.method} ${req.path}\n`);
      } catch (e: any) {
        res.send(500, 'text/plain', `err: ${e?.message ?? e}\n`);
      }
    },
  });

  // ── MCP route ─────────────────────────────────────────────────────

  function handleMcp(req: any, res: any): void {
    let msg: any;
    try {
      msg = JSON.parse(req.body || '{}');
    } catch (e: any) {
      res.send(400, 'application/json', mcpErr(null, -32700, `parse error: ${e?.message ?? e}`));
      return;
    }
    const id = msg?.id ?? null;
    const method = String(msg?.method ?? '');

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      res.send(204, 'application/json', '');
      return;
    }
    if (method === 'initialize') {
      res.send(200, 'application/json', mcpResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'claudewrap-bridge', version: '0.1.0' },
      }));
      return;
    }
    if (method === 'tools/list') {
      res.send(200, 'application/json', mcpResult(id, {
        tools: [RESPOND_TOOL, CALL_TOOL_TOOL],
      }));
      return;
    }
    if (method === 'ping') {
      res.send(200, 'application/json', mcpResult(id, {}));
      return;
    }
    if (method !== 'tools/call') {
      res.send(200, 'application/json', mcpErr(id, -32601, `method not found: ${method}`));
      return;
    }

    // tools/call dispatch
    const params = msg?.params ?? {};
    const toolName = String(params?.name ?? '');
    const args = params?.arguments ?? {};

    if (toolName === 'respond') { handleMcpRespond(id, args, res); return; }
    if (toolName === 'call_tool') { handleMcpCallTool(id, args, res); return; }
    res.send(200, 'application/json', mcpErr(id, -32602, `unknown tool: ${toolName}`));
  }

  function handleMcpRespond(id: any, args: any, res: any): void {
    const text = typeof args?.text === 'string' ? args.text : '';
    const callChatId = typeof args?.chat_id === 'string' ? args.chat_id : '';
    const callTurnId = typeof args?.turn_id === 'string' ? args.turn_id : '';
    if (!text) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{ type: 'text', text: 'error: respond requires non-empty text argument' }],
        isError: true,
      }));
      return;
    }
    if (!callChatId || !callTurnId) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{
          type: 'text',
          text: 'error: respond requires chat_id and turn_id (copy from prompt directive)',
        }],
        isError: true,
      }));
      return;
    }
    // Pooled (headless) path: route to the owning thread's turn. The
    // reply itself resolves on transcript end_turn (which prefers this
    // buffered text), so we just accumulate parts here.
    const pooledTurn = headless ? turnsRef.current.get(`${callChatId}-${callTurnId}`) : null;
    if (pooledTurn) {
      pooledTurn.mcpBuffer.push(text);
      pooledTurn.trace.events?.push?.({
        at: Date.now(),
        phase: 'mcp-respond-buffered',
        chat_id: callChatId,
        turn_id: callTurnId,
        partIndex: pooledTurn.mcpBuffer.length - 1,
        textPreview: text.slice(0, 120),
      });
      res.send(200, 'application/json', mcpResult(id, {
        content: [{ type: 'text', text: `buffered — emit ${pooledTurn.endMarker} when done` }],
      }));
      return;
    }

    const activeChat = activeChatIdRef.current;
    const activeTurn = activeTurnIdRef.current;
    if (!httpResolveRef.current || !activeChat || !activeTurn) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{
          type: 'text',
          text: `error: no pending bridge request — ignoring stale respond ` +
                `(claimed chat=${callChatId} turn=${callTurnId}). This usually ` +
                `means you're typing directly in the TUI rather than ` +
                `responding to a /v1/chat/completions request.`,
        }],
        isError: true,
      }));
      return;
    }
    if (callChatId !== activeChat || callTurnId !== activeTurn) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{
          type: 'text',
          text: `error: id mismatch — claimed chat=${callChatId} turn=${callTurnId}, ` +
                `active chat=${activeChat} turn=${activeTurn}. Use the ids from ` +
                `the CURRENT prompt's directive, not a previous one.`,
        }],
        isError: true,
      }));
      return;
    }
    mcpBufferRef.current.push(text);
    activeTraceRef.current?.events?.push?.({
      at: Date.now(),
      phase: 'mcp-respond-buffered',
      chat_id: callChatId,
      turn_id: callTurnId,
      partIndex: mcpBufferRef.current.length - 1,
      textPreview: text.slice(0, 120),
    });
    res.send(200, 'application/json', mcpResult(id, {
      content: [{
        type: 'text',
        text: `buffered — emit [END_${activeChat}-${activeTurn}] when done`,
      }],
    }));
  }

  function handleMcpCallTool(id: any, args: any, res: any): void {
    const callChatId = typeof args?.chat_id === 'string' ? args.chat_id : '';
    const callTurnId = typeof args?.turn_id === 'string' ? args.turn_id : '';
    const callName = typeof args?.name === 'string' ? args.name : '';
    const callArgsJson = typeof args?.arguments_json === 'string' ? args.arguments_json : '';
    const activeChat = activeChatIdRef.current;
    const activeTurn = activeTurnIdRef.current;

    if (!callName) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{ type: 'text', text: 'error: call_tool requires non-empty name' }],
        isError: true,
      }));
      return;
    }
    if (!callChatId || !callTurnId) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{
          type: 'text',
          text: 'error: call_tool requires chat_id + turn_id (copy from prompt directive)',
        }],
        isError: true,
      }));
      return;
    }
    // Pooled (headless) path: validate + invoke against the owning turn.
    const pooledTurn = headless ? turnsRef.current.get(`${callChatId}-${callTurnId}`) : null;
    if (pooledTurn) {
      if (!pooledTurn.resolveTools) {
        res.send(200, 'application/json', mcpResult(id, {
          content: [{ type: 'text', text: 'error: turn no longer accepting tool invocations' }],
          isError: true,
        }));
        return;
      }
      const known = pooledTurn.tools.map((t) => String(t?.function?.name ?? t?.name ?? '')).filter(Boolean);
      if (!known.includes(callName)) {
        res.send(200, 'application/json', mcpResult(id, {
          content: [{ type: 'text', text: `error: tool "${callName}" not in this turn's set. Available: ${known.join(', ') || '(none)'}` }],
          isError: true,
        }));
        return;
      }
      const toolCallId = `call_${randHex(10)}`;
      pendingToolCallsRef.current.set(toolCallId, {
        mcpReqId: id,
        mcpRes: res,
        toolName: callName,
        argumentsJson: callArgsJson,
        createdAt: Date.now(),
        responded: false,
        turnKey: `${callChatId}-${callTurnId}`,
      });
      pooledTurn.trace.events?.push?.({
        at: Date.now(), phase: 'tool-invoke', chat_id: callChatId, turn_id: callTurnId,
        tool_call_id: toolCallId, name: callName, argumentsPreview: callArgsJson.slice(0, 200),
      });
      const resolve = pooledTurn.resolveTools;
      pooledTurn.resolveTools = null;
      resolve([{ id: toolCallId, type: 'function', function: { name: callName, arguments: callArgsJson } }]);
      return;
    }

    if (!activeChat || !activeTurn || !toolInvokeResolveRef.current) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{
          type: 'text',
          text: `error: no pending bridge request for tool invocation ` +
                `(claimed chat=${callChatId} turn=${callTurnId})`,
        }],
        isError: true,
      }));
      return;
    }
    if (callChatId !== activeChat || callTurnId !== activeTurn) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{
          type: 'text',
          text: `error: id mismatch on call_tool — claimed chat=${callChatId} ` +
                `turn=${callTurnId}, active chat=${activeChat} turn=${activeTurn}.`,
        }],
        isError: true,
      }));
      return;
    }
    const knownNames = activeToolsRef.current
      .map((t) => String(t?.function?.name ?? t?.name ?? ''))
      .filter(Boolean);
    if (!knownNames.includes(callName)) {
      res.send(200, 'application/json', mcpResult(id, {
        content: [{
          type: 'text',
          text: `error: tool "${callName}" is not in the active tool set. ` +
                `Available this turn: ${knownNames.join(', ') || '(none)'}`,
        }],
        isError: true,
      }));
      return;
    }
    const toolCallId = `call_${randHex(10)}`;
    pendingToolCallsRef.current.set(toolCallId, {
      mcpReqId: id,
      mcpRes: res,
      toolName: callName,
      argumentsJson: callArgsJson,
      createdAt: Date.now(),
      responded: false,
    });
    activeTraceRef.current?.events?.push?.({
      at: Date.now(),
      phase: 'tool-invoke',
      chat_id: callChatId,
      turn_id: callTurnId,
      tool_call_id: toolCallId,
      name: callName,
      argumentsPreview: callArgsJson.slice(0, 200),
    });
    toolInvokeResolveRef.current([{
      id: toolCallId,
      type: 'function',
      function: { name: callName, arguments: callArgsJson },
    }]);
  }

  // ── /v1/chat/completions (pooled / headless) ──────────────────────
  //
  // Concurrent: each request runs independently (NOT through queueRef),
  // routed to its thread's own claude process. Resolution is by the
  // thread's sid-locked transcript reaching end_turn (pipe-agnostic),
  // preferring claude's clean bridge.respond text when it used MCP.

  type RaceResult =
    | { kind: 'text'; text: string }
    | { kind: 'tool_calls'; toolCalls: any[] };

  // Drive a turn to completion on its thread's own claude. When
  // `pasteText` is set this is a new user turn: paste it (re-pasting if a
  // just-spawned claude wasn't ready and dropped it), then resolve on the
  // transcript's end_turn. When undefined this is a tool-result follow-up:
  // claude continues on its own, we just wait. A hard timeout guarantees
  // the request always completes.
  async function runPooledTurn(turn: PooledTurn, startedAt: number, pasteText?: string): Promise<RaceResult> {
    const transcriptPath = `${claudeProjectDir()}/${turn.sid}.jsonl`;
    return await new Promise<RaceResult>((resolve) => {
      let done = false;
      let iv: any = null;
      const finish = (r: RaceResult) => {
        if (done) return;
        done = true;
        turn.resolveText = null;
        turn.resolveTools = null;
        turn.pending = null;
        if (iv != null) clearInterval(iv);
        resolve(r);
      };
      turn.resolveText = (text: string) => finish({ kind: 'text', text });
      turn.resolveTools = (toolCalls: any[]) => finish({ kind: 'tool_calls', toolCalls });
      turn.pending = {
        baseline: { path: transcriptPath, size: 0 }, // size 0 → parseAssistantTurn's ts floor scopes to our turn
        startMs: startedAt,
        sessionPrefix: '',
        sessionSnapshot: new Map(),
        lockedSid: turn.sid,
        lockedPath: transcriptPath,
        trace: turn.trace,
        resolve: () => {}, // resolvePendingFromTranscript drives turn.resolveText instead
      };

      let pastes = 0;
      const doPaste = () => {
        pastePrompt(turn.pipe, pasteText!);
        pastes++;
        turn.trace.events?.push?.({ at: Date.now(), phase: 'paste', n: pastes, sid: turn.sid });
      };
      if (pasteText) doPaste();

      let userSeen = false;
      iv = setInterval(() => {
        resolvePendingFromTranscript(); // resolves turn.resolveText/Tools → finish
        if (done) return;
        const elapsed = Date.now() - startedAt;
        // Readiness: if our prompt never showed up in the transcript, the
        // freshly-spawned claude likely wasn't ready — re-paste. Stop once
        // the user entry is present (re-pasting then would duplicate input).
        if (pasteText && !userSeen) {
          const raw = readFile(transcriptPath) ?? '';
          const pr = parseAssistantTurn(raw, startedAt);
          if (pr.sawUser) userSeen = true;
          else if (elapsed > pastes * POOL_REPASTE_GRACE_MS && pastes < POOL_MAX_PASTES) doPaste();
        }
        if (elapsed > POOL_TURN_TIMEOUT_MS) {
          turn.trace.events?.push?.({ at: Date.now(), phase: 'turn-timeout', sid: turn.sid, userSeen, pastes });
          finish({
            kind: 'text',
            text: userSeen
              ? '(bridge: claude received the message but did not finish replying in time)'
              : '(bridge: claude never picked up the prompt — the session may not have been ready)',
          });
        }
      }, TRANSCRIPT_POLL_MS);
    });
  }

  function sendTurnResult(res: any, result: RaceResult, turn: PooledTurn, body: any, wantStream: boolean): void {
    const model = String(body.model || DEFAULT_POOL_MODEL);
    turn.trace.events?.push?.({ at: Date.now(), phase: 'respond', kind: result.kind, sid: turn.sid });
    pushTrace(turn.trace);
    if (result.kind === 'tool_calls') {
      // Keep the turn alive for the follow-up; just stop it being
      // transcript-resolvable until the follow-up re-arms it.
      turn.resolveText = null;
      turn.pending = null;
      const id = `chatcmpl-claude-pty-${Date.now()}`;
      const payload = {
        id, object: 'chat.completion', created: nowSeconds(), model,
        external_session_id: turn.sid,
        choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: result.toolCalls }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      if (wantStream) {
        const chunk = JSON.stringify({
          id, object: 'chat.completion.chunk', created: payload.created, model, external_session_id: turn.sid,
          choices: [{ index: 0, delta: { role: 'assistant', tool_calls: result.toolCalls }, finish_reason: 'tool_calls' }],
        });
        res.send(200, 'text/event-stream', `data: ${chunk}\n\ndata: [DONE]\n\n`);
      } else {
        res.send(200, 'application/json', JSON.stringify(payload));
      }
      return;
    }
    // Text = turn done. Drop the turn + clear the per-sid marker.
    turnsRef.current.delete(`${turn.chatId}-${turn.turnId}`);
    try { writeFile(`${BRIDGE_TMP_DIR}/active-turn-${turn.sid}.json`, ''); } catch {}
    if (wantStream) {
      res.send(200, 'text/event-stream', streamingResponseBody(result.text, model, turn.sid));
    } else {
      res.send(200, 'application/json', completionResponse(result.text, model, turn.trace, turn.sid));
    }
  }

  async function handleChatCompletionsPooled(req: any, res: any): Promise<void> {
    const pool = poolRef.current!;
    const startedAt = Date.now();
    try {
      const body = JSON.parse(req.body || '{}');
      const wantStream = !!body.stream;
      const messages = Array.isArray(body.messages) ? body.messages : [];

      // Follow-up: tool results for an in-flight pooled turn.
      const toolResults = messages.filter((m: any) => m && m.role === 'tool' && typeof m.tool_call_id === 'string');
      const matching = toolResults.filter((m: any) => pendingToolCallsRef.current.has(m.tool_call_id));
      if (matching.length > 0) {
        const first = pendingToolCallsRef.current.get(matching[0].tool_call_id);
        const turn = first?.turnKey ? turnsRef.current.get(first.turnKey) : undefined;
        for (const m of matching) {
          const p = pendingToolCallsRef.current.get(m.tool_call_id);
          if (!p || p.responded) continue;
          p.responded = true;
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          p.mcpRes.send(200, 'application/json', mcpResult(p.mcpReqId, { content: [{ type: 'text', text: content }] }));
          pendingToolCallsRef.current.delete(m.tool_call_id);
        }
        if (!turn) {
          res.send(200, 'application/json', completionResponse('(tool results delivered; turn not found)', String(body.model || DEFAULT_POOL_MODEL)));
          return;
        }
        const result = await runPooledTurn(turn, startedAt);
        sendTurnResult(res, result, turn, body, wantStream);
        return;
      }

      // New user turn.
      const extracted = extractPrompt(body);
      const user = extracted.user.trim();
      const system = extracted.system.trim();
      if (!user) { res.send(400, 'application/json', errorResponse('missing user message')); return; }

      const model: BridgeModel = (typeof body.model === 'string' && isBridgeModel(body.model)) ? body.model : DEFAULT_POOL_MODEL;
      // body.user carries the thread's stored claude sid (resume key);
      // empty/absent means a brand-new thread → fresh spawn.
      const resumeSid = (typeof body.user === 'string' ? body.user.trim() : '');

      const proc = resumeSid ? await pool.resume(resumeSid, model) : await pool.spawnFresh(model);

      const chatId = (typeof body.chat_id === 'string' && body.chat_id) || `c${randHex(6)}`;
      const turnId = `t${randHex(6)}`;
      const turnKey = `${chatId}-${turnId}`;
      const endMarker = `[END_${chatId}-${turnId}]`;
      const tools = Array.isArray(body.tools) ? body.tools : [];

      const trace: BridgeTrace = {
        requestId: `bridge-${startedAt}`,
        cwd: cwdGet(),
        home: envGet('HOME'),
        projectDir: claudeProjectDir(),
        watchDir,
        baseline: { path: `${claudeProjectDir()}/${proc.sid}.jsonl`, size: 0 },
        promptPreview: user.slice(0, 160),
        sessionPrefix: '',
        runtimeDir: runtimeDir(),
        events: [{
          at: startedAt, phase: 'pool-turn-open',
          chat_id: chatId, turn_id: turnId, endMarker,
          sid: proc.sid, pipe: proc.pipe, model: proc.model,
          resumed: !!resumeSid, toolsCount: tools.length,
        }],
      };

      const turn: PooledTurn = {
        chatId, turnId, endMarker, sid: proc.sid, pipe: proc.pipe,
        tools, system, mcpBuffer: [], pending: null, resolveText: null, resolveTools: null, trace,
      };
      turnsRef.current.set(turnKey, turn);

      // Drive claude as a PLAIN session: do NOT inject the bridge
      // protocol (chat_id/turn_id/bridge.respond/endMarker). That blob
      // made claude narrate a handshake ("the bridge connection")
      // instead of just answering. The reply resolves from the
      // transcript's end_turn and claude uses its own native tools, so
      // the protocol isn't needed. We still pass through the caller's
      // system framing when present (NOT the user's visible message).
      if (system) {
        writeTurnMarker(
          proc.sid,
          `(System context for this turn — treat as framing, not the user's message:\n\n${system}\n)`,
          chatId, turnId, endMarker,
        );
      }

      // runPooledTurn does the paste (with readiness re-paste) + resolve.
      const result = await runPooledTurn(turn, startedAt, user);
      sendTurnResult(res, result, turn, body, wantStream);
    } catch (e: any) {
      res.send(500, 'application/json', errorResponse(e?.message ?? String(e)));
    }
  }

  // ── /v1/chat/completions ──────────────────────────────────────────

  function handleChatCompletions(req: any, res: any): void {
    if (headless) { void handleChatCompletionsPooled(req, res); return; }
    queueRef.current = queueRef.current.then(async () => {
      try {
        const body = JSON.parse(req.body || '{}');
        const wantStream = !!body.stream;

        // Follow-up detection: role:"tool" message whose tool_call_id
        // matches a pending entry means this HTTP request is delivering
        // tool results back into an active agentic loop.
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const toolResultMessages = messages.filter((m: any) =>
          m && m.role === 'tool' && typeof m.tool_call_id === 'string');
        const matchingPending = toolResultMessages.filter((m: any) =>
          pendingToolCallsRef.current.has(m.tool_call_id));
        const isFollowUp = matchingPending.length > 0;

        let chatId: string;
        let turnId: string;
        let endMarker: string;
        let sessionPrefix = '';
        let sessionSnapshot: Map<string, number> = new Map();
        let transcriptBaseline: { path: string; size: number } | null = null;
        let trace: BridgeTrace;
        const startedAt = Date.now();

        if (isFollowUp) {
          chatId = activeChatIdRef.current || 'recovered-chat';
          turnId = activeTurnIdRef.current || 'recovered-turn';
          endMarker = `[END_${chatId}-${turnId}]`;
          trace = {
            requestId: `bridge-${startedAt}`,
            cwd: cwdGet(),
            home: envGet('HOME'),
            projectDir: claudeProjectDir(),
            watchDir,
            baseline: null,
            promptPreview: '(follow-up: tool results)',
            sessionPrefix: terminalSessionPrefix(),
            runtimeDir: runtimeDir(),
            events: [{
              at: startedAt,
              phase: 'follow-up-start',
              chat_id: chatId,
              turn_id: turnId,
              toolResultsCount: matchingPending.length,
              toolCallIds: matchingPending.map((m: any) => m.tool_call_id),
            }],
          };
          activeTraceRef.current = trace;

          for (const m of matchingPending) {
            const pending = pendingToolCallsRef.current.get(m.tool_call_id);
            if (!pending || pending.responded) continue;
            pending.responded = true;
            const resultContent = typeof m.content === 'string'
              ? m.content
              : JSON.stringify(m.content);
            pending.mcpRes.send(200, 'application/json', mcpResult(pending.mcpReqId, {
              content: [{ type: 'text', text: resultContent }],
            }));
            trace.events.push({
              at: Date.now(),
              phase: 'tool-result-delivered',
              tool_call_id: m.tool_call_id,
              tool_name: pending.toolName,
              content_preview: resultContent.slice(0, 200),
            });
            pendingToolCallsRef.current.delete(m.tool_call_id);
          }
        } else {
          const extracted = extractPrompt(body);
          const userPrompt = extracted.user.trim();
          const systemPrompt = extracted.system.trim();
          if (!userPrompt) {
            res.send(400, 'application/json', errorResponse('missing user message'));
            return;
          }
          chatId = (typeof body.chat_id === 'string' && body.chat_id) ||
                   (typeof body.user === 'string' && body.user) ||
                   `c${randHex(6)}`;
          turnId = `t${randHex(6)}`;
          endMarker = `[END_${chatId}-${turnId}]`;
          sessionPrefix = terminalSessionPrefix();
          sessionSnapshot = snapshotSessionPings();
          const preActiveSession = pickActiveSession();
          transcriptBaseline = preActiveSession
            ? { path: preActiveSession.transcriptPath, size: preActiveSession.transcriptSize }
            : latestTranscript(sessionPrefix);
          trace = {
            requestId: `bridge-${startedAt}`,
            cwd: cwdGet(),
            home: envGet('HOME'),
            projectDir: claudeProjectDir(),
            watchDir,
            baseline: transcriptBaseline,
            promptPreview: userPrompt.slice(0, 160),
            sessionPrefix,
            runtimeDir: runtimeDir(),
            events: [{
              at: startedAt,
              phase: 'before-send',
              rowsSessionPrefix: sessionPrefix,
              userPromptPreview: userPrompt.slice(0, 200),
              systemPromptLen: systemPrompt.length,
              systemPromptPreview: systemPrompt.slice(0, 200),
              sessionSnapshot: Array.from(sessionSnapshot.entries()).map(([sid, ping]) => ({ sid, pingMs: ping })),
              candidates: describeCandidates(sessionPrefix),
              transcriptDiagnostics: transcriptDiagnostics(),
            }],
          };
          activeTraceRef.current = trace;
          activeChatIdRef.current = chatId;
          activeTurnIdRef.current = turnId;
          activeToolsRef.current = Array.isArray(body.tools) ? body.tools : [];
          activeSystemRef.current = systemPrompt;
          mcpBufferRef.current = [];
          trace.events.push({
            at: Date.now(),
            phase: 'turn-open',
            chat_id: chatId,
            turn_id: turnId,
            endMarker,
            toolsCount: activeToolsRef.current.length,
            hasSystemContext: systemPrompt.length > 0,
          });
          // System content rides through the UserPromptSubmit hook's
          // additionalContext (claude sees it as system framing, NOT as
          // part of the user message). Only the user's actual prompt
          // goes through the PTY paste so the visible chat shows what
          // the user typed.
          writePty(`\x1b[200~${userPrompt}\x1b[201~\r`);
        }

        // ── Wait race ───────────────────────────────────────────────
        type RaceResult =
          | { kind: 'text'; text: string }
          | { kind: 'tool_calls'; toolCalls: any[] };

        const transcriptPromise = new Promise<string>((resolve) => {
          pendingRef.current = {
            baseline: transcriptBaseline,
            startMs: startedAt,
            sessionPrefix,
            sessionSnapshot,
            lockedSid: '',
            lockedPath: '',
            trace,
            resolve,
          };
        });

        let turnDoneWatchId: any = null;
        let emptyBufferLogged = false;
        const turnDonePromise = new Promise<string>((resolve) => {
          httpResolveRef.current = resolve;
          turnDoneWatchId = setInterval(() => {
            const rows = allRowsText();
            let markerSeen = false;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i].includes(endMarker)) { markerSeen = true; break; }
            }
            if (!markerSeen) return;
            const buffered = mcpBufferRef.current.join('\n\n').trim();
            if (!buffered) {
              if (!emptyBufferLogged) {
                trace.events.push({
                  at: Date.now(),
                  phase: 'turn-done-empty-buffer',
                  endMarker,
                });
                emptyBufferLogged = true;
              }
              return;
            }
            clearInterval(turnDoneWatchId);
            turnDoneWatchId = null;
            trace.resolvedBy = 'mcp-respond+turn-done';
            trace.events.push({
              at: Date.now(),
              phase: 'turn-done-flush',
              chat_id: chatId,
              turn_id: turnId,
              parts: mcpBufferRef.current.length,
              textPreview: buffered.slice(0, 120),
            });
            resolve(buffered);
          }, TRANSCRIPT_POLL_MS);
        });

        const toolInvokePromise = new Promise<RaceResult>((resolve) => {
          toolInvokeResolveRef.current = (toolCalls) => {
            trace.resolvedBy = 'mcp-tool-invoke';
            trace.events.push({
              at: Date.now(),
              phase: 'tool-invoke-resolve',
              toolCallsCount: toolCalls.length,
            });
            resolve({ kind: 'tool_calls', toolCalls });
          };
        });

        const pollId = setInterval(() => {
          trace.events.push({ at: Date.now(), phase: 'poll' });
          resolvePendingFromTranscript();
        }, TRANSCRIPT_POLL_MS);
        const result = await Promise.race<RaceResult>([
          toolInvokePromise,
          turnDonePromise.then((text): RaceResult => ({ kind: 'text', text })),
          transcriptPromise.then((text): RaceResult => ({ kind: 'text', text })),
        ]);
        clearInterval(pollId);
        if (turnDoneWatchId != null) clearInterval(turnDoneWatchId);
        httpResolveRef.current = null;
        toolInvokeResolveRef.current = null;
        if (pendingRef.current?.startMs === startedAt) {
          pendingRef.current = null;
        }
        trace.events.push({
          at: Date.now(),
          phase: 'respond',
          resolvedBy: trace.resolvedBy,
          fallbackReason: trace.fallbackReason,
          kind: result.kind,
        });
        pushTrace(trace);

        if (result.kind === 'tool_calls') {
          activeTraceRef.current = null;
          const toolCallsResponse = {
            id: `chatcmpl-claude-pty-${Date.now()}`,
            object: 'chat.completion',
            created: nowSeconds(),
            model: String(body.model || MODEL_ID),
            choices: [{
              index: 0,
              message: { role: 'assistant', content: null, tool_calls: result.toolCalls },
              finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            bridge_trace: trace,
          };
          if (wantStream) {
            const chunk = JSON.stringify({
              id: toolCallsResponse.id,
              object: 'chat.completion.chunk',
              created: toolCallsResponse.created,
              model: toolCallsResponse.model,
              choices: [{
                index: 0,
                delta: { role: 'assistant', tool_calls: result.toolCalls },
                finish_reason: 'tool_calls',
              }],
            });
            res.send(200, 'text/event-stream', `data: ${chunk}\n\ndata: [DONE]\n\n`);
          } else {
            res.send(200, 'application/json', JSON.stringify(toolCallsResponse));
          }
        } else {
          // Diagnostic: log EXACTLY what's about to be sent in the
          // HTTP response. Combined with the mcp-respond-buffered +
          // turn-done-flush events upstream, this lets us pinpoint
          // any corruption between buffer → result.text → res.send.
          trace.events.push({
            at: Date.now(),
            phase: 'response-out',
            resultTextLen: (result.text ?? '').length,
            resultTextHead: (result.text ?? '').slice(0, 400),
            resultTextTail: (result.text ?? '').slice(-200),
            bufferAtSendLen: mcpBufferRef.current.reduce((a, b) => a + b.length, 0),
            bufferAtSendParts: mcpBufferRef.current.length,
            bufferAtSendHead: mcpBufferRef.current.join('\n\n').slice(0, 200),
            wantStream,
          });
          pushTrace(trace);

          // Text result = agentic loop done. Clear active refs and
          // drop any orphaned pending tool calls.
          activeTraceRef.current = null;
          activeChatIdRef.current = '';
          activeTurnIdRef.current = '';
          activeToolsRef.current = [];
          activeSystemRef.current = '';
          mcpBufferRef.current = [];
          for (const [id, p] of pendingToolCallsRef.current) {
            if (!p.responded) {
              try {
                p.mcpRes.send(200, 'application/json', mcpResult(p.mcpReqId, {
                  content: [{ type: 'text', text: 'error: turn abandoned, tool result never delivered' }],
                  isError: true,
                }));
              } catch {}
            }
            pendingToolCallsRef.current.delete(id);
          }
          if (wantStream) {
            res.send(200, 'text/event-stream',
              streamingResponseBody(result.text, String(body.model || MODEL_ID)));
          } else {
            res.send(200, 'application/json',
              completionResponse(result.text, String(body.model || MODEL_ID), trace));
          }
        }
      } catch (e: any) {
        res.send(500, 'application/json', errorResponse(e?.message ?? String(e)));
      }
    });
    queueRef.current.catch(() => {});
  }

  return null;
}
