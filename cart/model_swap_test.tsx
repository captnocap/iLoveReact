// model_swap_test — isolated harness for testing whether a chat stays
// coherent across mid-conversation model swaps.
//
// Hypothesis: the conversation lives in the cart, not in any single
// worker. Each turn we (re)spawn a worker for the picked model and
// hand it the entire transcript baked into one bootstrapping user
// message. If the protocol works, the user can switch models between
// turns and the new model continues the same thread coherently.
//
// Run:
//   ./scripts/ship model_swap_test
//
// Usage:
//   1. Pick a model from the row at top.
//   2. Type a message. The current model handles the turn.
//   3. Pick a different model. Type another message. The new model
//      receives the full prior transcript and continues.
//
// What to watch:
//   - Does the new model reference earlier turns correctly?
//   - When asked "what model are you?" does each model answer
//     truthfully, or does the prior model bleed through?
//   - Does context carry on multi-step tasks (e.g. ask model A to
//     remember a number, then ask model B to recall it)?

import { useState, useRef, useEffect, useMemo } from 'react';
import { Box, Pressable, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import { installBrowserShims } from '@reactjit/runtime/hooks';
import { useAssistant, type AssistantBackend } from '@reactjit/runtime/hooks/useAssistant';
import { useCRUD } from './app/db';
import { callHost, hasHost } from '@reactjit/runtime/ffi';

installBrowserShims();

const passthrough: any = { parse: (v: unknown) => v };

type Turn = { role: 'user' | 'assistant'; text: string; modelId?: string };

function kindToBackend(kind: string | undefined): AssistantBackend | undefined {
  if (!kind) return undefined;
  if (kind === 'claude-code-cli' || kind === 'anthropic-api-key') return 'claude_code';
  if (kind === 'kimi-api-key') return 'kimi_cli_wire';
  if (kind === 'codex-cli') return 'codex_app_server';
  if (kind === 'local-runtime') return 'local_ai';
  if (kind === 'openai-api-key' || kind === 'openai-api-like') return 'openai_compat';
  return undefined;
}

function envGet(key: string): string {
  if (!hasHost('__env')) return '';
  try { return callHost<string>('__env', '', key) || ''; } catch { return ''; }
}

function expandTilde(raw: string): string {
  const v0 = raw.trim();
  if (!v0) return '';
  // Tolerate "/~/foo" too — the OS would resolve a literal tilde from
  // cwd=/ as /~/foo, and that mangled form may already be in the DB
  // from earlier saves where the path was round-tripped through a
  // resolver that didn't strip the tilde first.
  const v = v0.startsWith('/~/') || v0 === '/~' ? v0.slice(1) : v0;
  if (v === '~') return envGet('HOME') || v;
  if (v.startsWith('~/')) {
    const home = envGet('HOME');
    if (home) return `${home}/${v.slice(2)}`;
  }
  return v;
}

// Mirrors cart/app/chat/useAssistantChat.ts:resolveConfigDir — when the
// locator is the SDK's default config dir (~/.claude) we return empty so
// the worker uses its built-in default. Anything else gets tilde-expanded.
function resolveConfigDir(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  if (v === '~/.claude' || v === '~/.claude/') return '';
  return expandTilde(v);
}

// Replace ASCII angle brackets with look-alike unicode chars so the
// framework's text primitive doesn't parse pseudo-tags (<think>,
// <|im_end|>, <answer>, etc.) as nested elements and drop everything
// after the close.
function sanitizeAngles(s: string): string {
  return s.replace(/</g, '‹').replace(/>/g, '›');
}

// Split a streaming local-model body into reasoning + response parts.
// Reasoning-tuned models (Qwen, DeepSeek-R1, etc.) emit thoughts inside
// `<think>…</think>`. Some emit both the open and the close; some
// templates implicitly open the block and only emit the close. We
// handle both. Without splitting, the framework's text primitive
// parses the pseudo-tags as nested elements and drops content past
// the close.
type Part = { kind: 'text' | 'think'; text: string };
function splitThink(body: string): Part[] {
  const parts: Part[] = [];
  let i = 0;
  // Implicit-open case: a `</think>` appears before any `<think>`.
  // Treat the prefix up to that close as a reasoning block.
  const firstOpen = body.indexOf('<think>');
  const firstClose = body.indexOf('</think>');
  if (firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen)) {
    if (firstClose > 0) parts.push({ kind: 'think', text: body.slice(0, firstClose) });
    i = firstClose + 8;
  }
  while (i < body.length) {
    const open = body.indexOf('<think>', i);
    if (open < 0) { parts.push({ kind: 'text', text: body.slice(i) }); break; }
    if (open > i) parts.push({ kind: 'text', text: body.slice(i, open) });
    const close = body.indexOf('</think>', open + 7);
    if (close < 0) { parts.push({ kind: 'think', text: body.slice(open + 7) }); break; }
    parts.push({ kind: 'think', text: body.slice(open + 7, close) });
    i = close + 8;
  }
  return parts.filter((p) => p.text.length > 0);
}

function processCwd(): string {
  if (hasHost('__cwd')) {
    try {
      const v = callHost<string>('__cwd', '');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return envGet('HOME') || '/';
}

function buildBootstrapPrompt(history: Turn[], next: string): string {
  // Render the prior turns as a transcript and append the user's new
  // message. This is the "synthetic-bootstrap" approach: any backend,
  // CLI or HTTP, sees the full thread as a single user message and is
  // told to continue. Coarse-grained but model-agnostic.
  if (history.length === 0) return next;
  const lines: string[] = [];
  lines.push('The following is an ongoing conversation between a user and an AI assistant. Continue the conversation naturally as the assistant. Do not summarize or restate the prior turns — just respond to the latest user message.');
  lines.push('');
  lines.push('--- transcript ---');
  for (const t of history) {
    const who = t.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${who}: ${t.text}`);
  }
  lines.push('--- end transcript ---');
  lines.push('');
  lines.push(`User: ${next}`);
  lines.push('');
  lines.push('Assistant:');
  return lines.join('\n');
}

export default function ModelSwapTest() {
  const modelStore = useCRUD<any>('model', passthrough, { namespace: 'app' });
  const connectionStore = useCRUD<any>('connection', passthrough, { namespace: 'app' });

  const { data: allModels } = modelStore.useListQuery({});
  const { data: allConnections } = connectionStore.useListQuery({});

  const textModels = useMemo(
    () => (allModels || []).filter((m: any) => m?.modality === 'text'),
    [allModels],
  );

  const [selectedModelId, setSelectedModelId] = useState<string>('');
  useEffect(() => {
    if (!selectedModelId && textModels.length > 0) {
      setSelectedModelId(textModels[0].id);
    }
  }, [textModels, selectedModelId]);

  const selectedModel = textModels.find((m: any) => m.id === selectedModelId);
  const selectedConn = (allConnections || []).find((c: any) => c.id === selectedModel?.connectionId);

  const kind = selectedConn?.kind as string | undefined;
  const backend = kindToBackend(kind);
  const cwd = processCwd();
  const remoteId = selectedModel?.remoteId || '';
  const baseUrl = backend === 'openai_compat' ? (selectedConn?.endpoint || '') : '';
  const apiKey = useMemo(() => {
    if (backend !== 'openai_compat') return '';
    const cr = selectedConn?.credentialRef;
    if (!cr) return '';
    if (cr.source === 'env') return envGet(String(cr.locator || ''));
    return String(cr.locator || '');
  }, [backend, selectedConn?.credentialRef?.source, selectedConn?.credentialRef?.locator]);
  // For local-runtime, the .gguf file path lives on the model row's
  // remoteId (set by the gguf-walk in settings/lib/fetch.ts), NOT on
  // the connection's folder credential. Pass the model's remoteId as
  // modelPath so local_ai_runtime opens the actual file. expandTilde
  // is defensive — discovery already stores absolute paths but we
  // tolerate either form.
  const modelPath =
    kind === 'local-runtime' && selectedModel?.remoteId
      ? expandTilde(String(selectedModel.remoteId))
      : '';
  const configDir =
    kind === 'claude-code-cli' && selectedConn?.credentialRef?.locator
      ? resolveConfigDir(String(selectedConn.credentialRef.locator))
      : '';

  const assistant = useAssistant({
    backend,
    cwd,
    model: remoteId,
    modelPath,
    configDir,
    // Local model context: pull from the model row's contextLength
    // (set by the gguf-walk / list fetch in settings/lib/fetch.ts).
    // Fall back to 32k — the 4096 default is too small for any
    // multi-turn bootstrap and forces the model to truncate the
    // transcript mid-prompt.
    nCtx: backend === 'local_ai' ? (Number(selectedModel?.contextLength) || 32768) : undefined,
    // Generation cap. The runtime's prior 256-token default truncated
    // every reply mid-sentence; 8192 is enough headroom for a
    // reasoning-heavy local model to finish thinking AND respond.
    maxTokens: backend === 'local_ai' ? 8192 : undefined,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
  });

  // ── Conversation state (cart owns the transcript) ──────────────────
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const [input, setInput] = useState('');
  const inputRef = useRef('');
  inputRef.current = input;

  // Active assistant turn we're streaming into. Index points into turns
  // for in-place updates; null when no turn is in flight.
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const pendingIdxRef = useRef<number | null>(null);
  pendingIdxRef.current = pendingIdx;

  // Diagnostic: show what the last submit did. Tells us whether the
  // worker accepted our send vs silently dropped it.
  const [lastSendInfo, setLastSendInfo] = useState<string>('');

  const cursorRef = useRef(0);

  // Drain assistant_message / completion events into the active turn.
  useEffect(() => {
    const events = assistant.events;
    if (events.length <= cursorRef.current) return;
    const idx = pendingIdxRef.current;
    let accum = idx != null ? (turnsRef.current[idx]?.text || '') : '';
    let done = false;
    for (let i = cursorRef.current; i < events.length; i += 1) {
      const ev = events[i];
      if (ev.kind === 'assistant_message' && ev.role === 'assistant' && typeof ev.text === 'string') {
        accum += ev.text;
        if (idx != null) {
          setTurns((cur) => {
            const next = cur.slice();
            next[idx] = { ...next[idx], text: accum };
            return next;
          });
        }
      } else if (ev.kind === 'completion') {
        done = true;
      }
    }
    cursorRef.current = events.length;
    if (done && idx != null) {
      setPendingIdx(null);
    }
  }, [assistant.events]);

  // When the worker respawns (model swap), reset the event cursor so we
  // don't replay events from the prior worker into the next turn.
  useEffect(() => {
    cursorRef.current = 0;
  }, [assistant.workerId]);

  const submit = () => {
    const text = inputRef.current.trim();
    if (!text) return;
    // Don't gate on ready() — claude_code stays in 'starting' until the
    // first event arrives, which only happens after a send, so a strict
    // ready gate deadlocks the very first turn. assistant.ask() returns
    // false when the worker isn't actually accepting input; rely on that.
    if (assistant.phase === 'failed' || assistant.phase === 'closed') return;
    if (pendingIdxRef.current != null) return;

    const history = turnsRef.current.slice();
    const userTurn: Turn = { role: 'user', text, modelId: selectedModelId };
    const asstTurn: Turn = { role: 'assistant', text: '', modelId: selectedModelId };
    const next = [...history, userTurn, asstTurn];
    setTurns(next);
    setPendingIdx(next.length - 1);
    setInput('');

    const prompt = buildBootstrapPrompt(history, text);
    const ok = assistant.ask(prompt);
    setLastSendInfo(`ask returned ${ok} · ${prompt.length} chars · phase=${assistant.phase} · workerId=${assistant.workerId ?? 'none'}`);
    if (!ok) {
      setTurns((cur) => cur.slice(0, -1).concat([{ ...asstTurn, text: '[ask failed]' }]));
      setPendingIdx(null);
    }
  };

  const clearChat = () => {
    setTurns([]);
    setPendingIdx(null);
  };

  return (
    <Box style={{
      flexGrow: 1, flexDirection: 'column',
      backgroundColor: '#0e0e10',
      width: '100%', height: '100%',
      paddingTop: 18, paddingBottom: 18, paddingLeft: 18, paddingRight: 18,
      gap: 12,
    }}>
      {/* Header — phase + worker + model count */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Box style={{
          paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8,
          backgroundColor: phaseColor(assistant.phase), borderRadius: 4,
        }}>
          <span style={{ color: '#fff', fontFamily: 'monospace', fontSize: 12 }}>
            {assistant.phase}
          </span>
        </Box>
        <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 11 }}>
          worker: {assistant.workerId ?? '(none)'} · backend: {backend ?? '(none)'} · {textModels.length} text models
        </span>
        <Box style={{ flexGrow: 1 }} />
        <Pressable onPress={clearChat}>
          <Box style={{
            paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12,
            backgroundColor: '#3a3a40', borderRadius: 4,
          }}>
            <span style={{ color: '#ccc', fontFamily: 'monospace', fontSize: 12 }}>
              clear
            </span>
          </Box>
        </Pressable>
      </Box>

      {assistant.error ? (
        <Box>
          <span style={{ color: '#ff6b6b', fontFamily: 'monospace', fontSize: 12 }}>
            error: {assistant.error}
          </span>
        </Box>
      ) : null}

      {/* Debug — raw event tail so we can see what the worker is emitting. */}
      <Box style={{
        flexDirection: 'column', gap: 2,
        backgroundColor: '#0a0a0d', borderRadius: 4,
        paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8,
        maxHeight: 110, overflow: 'scroll',
      }}>
        {lastSendInfo ? (
          <span style={{ color: '#bbb', fontFamily: 'monospace', fontSize: 10 }}>
            last send: {lastSendInfo}
          </span>
        ) : null}
        <span style={{ color: '#666', fontFamily: 'monospace', fontSize: 10 }}>
          events ({assistant.events.length}):
        </span>
        {assistant.events.slice(-12).map((ev) => (
          <span key={ev.id} style={{ color: '#999', fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre-wrap' }}>
            #{ev.id} {ev.kind}{ev.role ? `/${ev.role}` : ''}{ev.phase ? `[${ev.phase}]` : ''}{ev.status_text ? ` · ${ev.status_text}` : ''}{ev.text ? ` · ${ev.text.slice(0, 80)}` : ''}{ev.payload_json && !ev.text ? ` · ${ev.payload_json.slice(0, 80)}` : ''}
          </span>
        ))}
      </Box>

      {/* Model picker — every text model in the DB */}
      <Box style={{ flexDirection: 'column', gap: 4 }}>
        <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 11 }}>
          model for next turn:
        </span>
        <ScrollView showScrollbar style={{
          maxHeight: 80,
          backgroundColor: '#15151a',
          borderRadius: 6,
        }}>
          <Box style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: 6,
            paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10,
          }}>
            {textModels.length === 0 ? (
              <span style={{ color: '#666', fontFamily: 'monospace', fontSize: 12 }}>
                no text models in DB — configure providers in the main app first
              </span>
            ) : textModels.map((m: any) => {
              const c = (allConnections || []).find((cc: any) => cc.id === m.connectionId);
              const isSel = m.id === selectedModelId;
              return (
                <Pressable key={m.id} onPress={() => setSelectedModelId(m.id)}>
                  <Box style={{
                    paddingTop: 6, paddingBottom: 6, paddingLeft: 10, paddingRight: 10,
                    backgroundColor: isSel ? '#3b82f6' : '#1f1f24',
                    borderRadius: 4,
                    flexDirection: 'column',
                  }}>
                    <span style={{
                      color: isSel ? '#fff' : '#ccc',
                      fontFamily: 'monospace', fontSize: 12,
                    }}>
                      {m.displayName || m.remoteId}
                    </span>
                    <span style={{
                      color: isSel ? '#dbe9ff' : '#777',
                      fontFamily: 'monospace', fontSize: 10,
                    }}>
                      {c?.label || c?.kind || '(no conn)'}
                    </span>
                  </Box>
                </Pressable>
              );
            })}
          </Box>
        </ScrollView>
      </Box>

      {/* Transcript */}
      <ScrollView showScrollbar style={{
        flexGrow: 1,
        backgroundColor: '#15151a',
        borderRadius: 6,
        width: '100%',
      }}>
        <Box style={{
          flexDirection: 'column', gap: 10,
          paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14,
        }}>
          {turns.length === 0 ? (
            <span style={{ color: '#666', fontFamily: 'monospace', fontSize: 12 }}>
              no turns yet — pick a model and send a message
            </span>
          ) : turns.map((t, i) => {
            const m = (allModels || []).find((mm: any) => mm.id === t.modelId);
            const tag = t.role === 'user' ? 'user' : (m?.displayName || m?.remoteId || 'assistant');
            return (
              <Box key={i} style={{
                flexDirection: 'column',
                borderLeftWidth: 3,
                borderLeftColor: t.role === 'user' ? '#888' : '#3b82f6',
                paddingLeft: 10,
              }}>
                <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 10 }}>
                  {tag}
                </span>
                {/* Local / open models stream pseudo-tags inline:
                    <think>…</think>, <|channel>thought<channel|>,
                    <|im_end|>, <answer>, etc. The framework's text
                    primitive parses any "<…>" sequence as a nested
                    element and drops anything after the close — so we
                    sanitize ALL angle brackets to safe look-alikes
                    before rendering. We also pull <think> blocks out
                    so they render dim/italic. */}
                {(() => {
                  const body = t.text || '';
                  if (!body) {
                    return (
                      <span style={{ color: '#666', fontFamily: 'monospace', fontSize: 13 }}>
                        {i === pendingIdx ? '…' : ''}
                      </span>
                    );
                  }
                  // Only run reasoning extraction on assistant turns —
                  // user prose may legitimately contain "<think>" as a
                  // word or quoted reference and we shouldn't strip it.
                  const parts = t.role === 'assistant'
                    ? splitThink(body)
                    : [{ kind: 'text' as const, text: body }];
                  return parts.map((p, pi) => (
                    <span key={pi} style={{
                      color: p.kind === 'think' ? '#777' : '#e8e8e8',
                      fontFamily: 'monospace', fontSize: 13,
                      fontStyle: p.kind === 'think' ? 'italic' : 'normal',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {p.kind === 'think'
                        ? `[reasoning]\n${sanitizeAngles(p.text)}\n[/reasoning]\n`
                        : sanitizeAngles(p.text)}
                    </span>
                  ));
                })()}
              </Box>
            );
          })}
        </Box>
      </ScrollView>

      {/* Composer */}
      <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Box style={{
          flexGrow: 1,
          backgroundColor: '#1a1a1f',
          borderRadius: 6,
          paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
        }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submit}
            placeholder={
              !backend ? 'pick a model with a valid connection…'
              : assistant.phase === 'failed' ? 'worker failed — see error above'
              : assistant.phase === 'closed' ? 'worker closed'
              : pendingIdx != null ? 'awaiting reply…'
              : 'message…'
            }
            style={{
              color: '#e8e8e8', fontFamily: 'monospace', fontSize: 14,
              width: '100%',
            }}
          />
        </Box>
        <Pressable onPress={submit}>
          <Box style={{
            paddingTop: 10, paddingBottom: 10, paddingLeft: 18, paddingRight: 18,
            backgroundColor: backend && pendingIdx == null && assistant.phase !== 'failed' && assistant.phase !== 'closed' ? '#3b82f6' : '#3a3a40',
            borderRadius: 6,
          }}>
            <span style={{ color: '#fff', fontFamily: 'monospace', fontSize: 13 }}>send</span>
          </Box>
        </Pressable>
      </Box>
    </Box>
  );
}

function phaseColor(phase: string): string {
  switch (phase) {
    case 'idle': return '#3a7d3a';
    case 'streaming': return '#3b82f6';
    case 'failed': return '#b03030';
    case 'closed': return '#555';
    case 'starting': return '#ad7f2a';
    default: return '#3a3a40';
  }
}
