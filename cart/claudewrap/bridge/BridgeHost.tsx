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
import { ensureClaudeLauncher } from './launcher';
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
} from './transcript';
import { claudeProjectDir, cwdGet, envGet, nowSeconds, randHex, runtimeDir } from './common';
import { pushTrace } from './trace-store';
import { useSettings } from '../state';
import type { BridgeTrace, PendingCompletion, PendingToolCall } from './types';

const MODEL_ID = 'live-claude-code';
const POLL_MS = 500;
const MAX_WAIT_MS = 120_000;
const TRANSCRIPT_POLL_MS = 250;
// Wait long enough for Claude to flush stop_reason="end_turn" on a
// normal text response (2–5s) before the terminal-scrape fallback
// races in.
const TERMINAL_FALLBACK_GRACE_MS = 10_000;

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

function allRowsText(): string[] {
  const n = vtermRows();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(rowText(i));
  return out;
}

function compactLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}

function assistantText(): string {
  semBuildGraph();
  const exported = semExport() as any;
  const rows = Array.isArray(exported?.rows) ? exported.rows : [];
  const assistantRows = rows
    .filter((row: any) => row?.kind === 'assistant_text' || row?.role === 'assistant')
    .map((row: any) => String(row.text ?? '').trimEnd())
    .filter((line: string) => line.trim().length > 0);
  if (assistantRows.length > 0) return compactLines(assistantRows.join('\n'));

  // Fallback for early classifier misses: visible rows minus obvious
  // UI chrome.
  return compactLines(
    allRowsText()
      .filter((line) => {
        const t = line.trim();
        if (!t) return false;
        if (t.includes('http://localhost:')) return false;
        if (t.startsWith('claude-openai-bridge')) return false;
        return true;
      })
      .join('\n'),
  );
}

function terminalSessionPrefix(): string {
  const rows = allRowsText();
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i].match(/(?:^|\s)([0-9a-f]{4})\s+·\s+/i);
    if (m) return m[1].toLowerCase();
  }
  return '';
}

function stripPrefix(before: string, after: string): string {
  if (!before) return after;
  if (after.startsWith(before)) return after.slice(before.length).trim();
  const idx = after.lastIndexOf(before);
  if (idx >= 0) return after.slice(idx + before.length).trim();
  return after;
}

// ── Request → prompt extraction ────────────────────────────────────

function messagePartText(part: any): string {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'text') return String(part.text ?? '');
  return '';
}

function extractPrompt(body: any): string {
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
  return system ? `${system}\n\n${user}` : user;
}

// ── Response shaping ────────────────────────────────────────────────

function completionResponse(content: string, model = MODEL_ID, trace?: BridgeTrace): string {
  return JSON.stringify({
    id: `chatcmpl-claude-pty-${Date.now()}`,
    object: 'chat.completion',
    created: nowSeconds(),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    bridge_trace: trace,
  });
}

function streamingResponseBody(content: string, model = MODEL_ID): string {
  const id = `chatcmpl-claude-pty-${Date.now()}`;
  const created = nowSeconds();
  const chunk = (delta: any, finish: string | null) => JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
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

// ── Terminal-scrape fallback ───────────────────────────────────────

async function waitForClaudeReply(beforeText: string): Promise<string> {
  const startedAt = Date.now();
  let sawBusy = false;
  let idleTicks = 0;
  let stableTicks = 0;
  let lastText = assistantText();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    semBuildGraph();
    const state = semState() as any;
    const busy = !!(state?.is_thinking || state?.is_responding || state?.is_tool_using || state?.permission_pending);
    const currentText = assistantText();
    const changed = currentText !== lastText;

    if (busy) sawBusy = true;
    idleTicks = busy ? 0 : idleTicks + 1;
    stableTicks = changed ? 0 : stableTicks + 1;
    lastText = currentText;

    const delta = stripPrefix(beforeText, currentText);
    if (delta && (sawBusy ? idleTicks >= 3 : stableTicks >= 6)) return delta;
  }

  const finalText = stripPrefix(beforeText, assistantText());
  return finalText || '(timed out waiting for Claude Code output; inspect /rows and /export)';
}

// ── Component ──────────────────────────────────────────────────────

export function BridgeHost() {
  const { bridgePort } = useSettings();

  // Materialize the launcher + MCP config once. ensureClaudeLauncher
  // is idempotent so re-running on settings changes is fine.
  React.useEffect(() => {
    ensureClaudeLauncher(bridgePort);
  }, [bridgePort]);

  // Cross-handler refs — same shape the source bridge used.
  const queueRef = React.useRef(Promise.resolve());
  const pendingRef = React.useRef<PendingCompletion | null>(null);
  const mcpBufferRef = React.useRef<string[]>([]);
  const httpResolveRef = React.useRef<((text: string) => void) | null>(null);
  const activeTraceRef = React.useRef<BridgeTrace | null>(null);
  const activeChatIdRef = React.useRef<string>('');
  const activeTurnIdRef = React.useRef<string>('');
  const activeToolsRef = React.useRef<any[]>([]);
  const pendingToolCallsRef = React.useRef<Map<string, PendingToolCall>>(new Map());
  const toolInvokeResolveRef = React.useRef<((toolCalls: any[]) => void) | null>(null);

  const resolvePendingFromTranscript = React.useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return false;
    const result = findClaudeTranscriptReply(pending);
    if (!result.complete) return false;
    pendingRef.current = null;
    pending.resolve(result.text || '(end_turn with no text)');
    return true;
  }, []);

  const watchDir = React.useMemo(() => claudeProjectDir(), []);
  useFileWatch(watchDir, () => {
    resolvePendingFromTranscript();
  }, { recursive: true, intervalMs: 100, pattern: '*.jsonl' });

  useHost({
    kind: 'http',
    port: bridgePort,
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
          res.send(200, 'application/json', JSON.stringify({
            object: 'list',
            data: [{ id: MODEL_ID, object: 'model', created: nowSeconds(), owned_by: 'local-pty' }],
          }));
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

  // ── /v1/chat/completions ──────────────────────────────────────────

  function handleChatCompletions(req: any, res: any): void {
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
          const prompt = extractPrompt(body).trim();
          if (!prompt) {
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
            promptPreview: prompt.slice(0, 160),
            sessionPrefix,
            runtimeDir: runtimeDir(),
            events: [{
              at: startedAt,
              phase: 'before-send',
              rowsSessionPrefix: sessionPrefix,
              sessionSnapshot: Array.from(sessionSnapshot.entries()).map(([sid, ping]) => ({ sid, pingMs: ping })),
              candidates: describeCandidates(sessionPrefix),
              transcriptDiagnostics: transcriptDiagnostics(),
            }],
          };
          activeTraceRef.current = trace;
          activeChatIdRef.current = chatId;
          activeTurnIdRef.current = turnId;
          activeToolsRef.current = Array.isArray(body.tools) ? body.tools : [];
          mcpBufferRef.current = [];
          trace.events.push({
            at: Date.now(),
            phase: 'turn-open',
            chat_id: chatId,
            turn_id: turnId,
            endMarker,
            toolsCount: activeToolsRef.current.length,
          });
          // The directive (chat_id/turn_id/endMarker + tool list) is
          // delivered via the VM-side UserPromptSubmit hook, which
          // curls GET /directive and feeds the response back as
          // hookSpecificOutput.additionalContext. That keeps it OUT
          // of the user-visible message body — claude sees it as
          // injected system context.
          //
          // composeDirective is still imported because /directive
          // builds the same string on demand from the live
          // chat/turn/tools refs. We just don't paste it here.
          writePty(`\x1b[200~${prompt}\x1b[201~\r`);
        }

        // ── Wait race ───────────────────────────────────────────────
        const before = assistantText();

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
          new Promise<RaceResult>((resolve) => {
            setTimeout(() => {
              trace.events.push({
                at: Date.now(),
                phase: 'terminal-fallback-start',
                sessionPrefix,
                candidates: describeCandidates(sessionPrefix),
              });
              waitForClaudeReply(before).then((text) => {
                if (!trace.resolvedBy) {
                  trace.resolvedBy = 'terminal-scrape';
                  trace.fallbackReason = 'terminal_fallback_grace_elapsed';
                }
                trace.events.push({
                  at: Date.now(),
                  phase: 'terminal-fallback-done',
                  textPreview: text.slice(0, 120),
                });
                resolve({ kind: 'text', text });
              }, (e) => resolve({ kind: 'text', text: `bridge fallback error: ${e?.message ?? e}` }));
            }, TERMINAL_FALLBACK_GRACE_MS);
          }),
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
          // Text result = agentic loop done. Clear active refs and
          // drop any orphaned pending tool calls.
          activeTraceRef.current = null;
          activeChatIdRef.current = '';
          activeTurnIdRef.current = '';
          activeToolsRef.current = [];
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
