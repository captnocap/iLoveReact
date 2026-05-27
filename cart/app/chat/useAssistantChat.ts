// useAssistantChat — bridge from cart's Promise-shaped chat API to the
// unified useAssistant hook. Mounts one worker (currently the
// `assistant` role), reads Settings → Actions to derive backend +
// model + connection, and exposes ask(text, { onPart }) so the existing
// AssistantChatProvider stays unchanged.
//
// Connection.kind → backend mapping:
//   - claude-code-cli   → claude_code     (claude_sdk drives the CLI)
//   - anthropic-api-key → claude_code     (same SDK; no configDir override)
//   - kimi-api-key      → kimi_cli_wire
//   - codex-cli         → codex_app_server (local `codex` stdio JSON-RPC)
//   - openai-api-key    → openai_compat   (OpenAI Chat Completions HTTP — also covers Codex via API key)
//   - openai-api-like   → openai_compat   (OpenRouter / LMStudio / Ollama / etc.)
//   - local-runtime     → local_ai

import { useEffect, useMemo, useRef } from 'react';
import { useCRUD } from '../db';
import { useCurrentSessionExternalId, setCurrentSessionExternalId } from './store';
import { useAssistant, type AssistantBackend } from '@reactjit/runtime/hooks/useAssistant';
import type { WorkerEvent } from '@reactjit/runtime/hooks/useAssistant';
import { callHost, hasHost } from '@reactjit/runtime/ffi';
import { listTools } from '../tools/registry';
import { useAssistantTools } from '../tools/useAssistantTools';

const NS = 'app';
const SETTINGS_ID = 'settings_default';
const passthrough: any = { parse: (v: unknown) => v };

function expandTilde(raw: string): string {
  const v0 = raw.trim();
  if (!v0) return '';
  // Tolerate "/~/foo" too — older saves resolved a literal tilde from
  // cwd=/ before reaching the consumer, baking the leading slash into
  // the stored locator.
  const v = v0.startsWith('/~/') || v0 === '/~' ? v0.slice(1) : v0;
  if (v === '~') {
    const home = hasHost('__env') ? (callHost<string>('__env', '', 'HOME') || '') : '';
    return home || v;
  }
  if (v.startsWith('~/')) {
    const home = hasHost('__env') ? (callHost<string>('__env', '', 'HOME') || '') : '';
    if (home) return `${home}/${v.slice(2)}`;
  }
  return v;
}

function resolveConfigDir(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  // The Claude SDK reads ~/.claude by default — return empty so it
  // uses the built-in default rather than receiving a redundant path.
  if (v === '~/.claude' || v === '~/.claude/') return '';
  return expandTilde(v);
}

function processCwd(): string {
  if (hasHost('__cwd')) {
    try {
      const v = callHost<string>('__cwd', '');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  if (hasHost('__env')) {
    try {
      const home = callHost<string>('__env', '', 'HOME');
      if (typeof home === 'string' && home.length > 0) return home;
    } catch { /* ignore */ }
  }
  return '/';
}

function kindToBackend(kind: string | undefined): AssistantBackend | undefined {
  if (!kind) return undefined;
  if (kind === 'claude-code-cli' || kind === 'anthropic-api-key') return 'claude_code';
  if (kind === 'kimi-api-key') return 'kimi_cli_wire';
  if (kind === 'codex-cli') return 'codex_app_server';
  if (kind === 'local-runtime') return 'local_ai';
  if (kind === 'openai-api-key' || kind === 'openai-api-like') return 'openai_compat';
  return undefined;
}

/** Render the cart's registered tools as an OpenAI-shape tools schema.
 *  argsSchema is a free-form string in the cart's Tool type, so we feed
 *  it into the description and use a permissive parameters schema. The
 *  dispatcher's tool.scopeOf() validates concrete args at invoke time. */
function buildToolsSchema(): string | undefined {
  const tools = listTools();
  if (tools.length === 0) return undefined;
  return JSON.stringify(tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: `${t.description}\n\nArgs (TS-shape): ${t.argsSchema}`,
      parameters: { type: 'object', additionalProperties: true },
    },
  })));
}

function envGet(key: string): string {
  if (!hasHost('__env')) return '';
  try { return callHost<string>('__env', '', key) || ''; } catch { return ''; }
}

export interface ChatAskOpts {
  onPart?: (partial: string) => void;
}

export interface UseAssistantChatOpts {
  modelId?: string;
  persistAcrossUnmount?: boolean;
}

export type AssistantRunMetadata = {
  backend?: string;
  model?: string;
  workerSessionId?: string;
  externalSessionId?: string;
  costUsd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
};

function emptyRunMetadata(): AssistantRunMetadata {
  return {
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    costUsd: 0,
  };
}

function foldMetadata(meta: AssistantRunMetadata, ev: WorkerEvent): void {
  meta.backend = meta.backend || ev.backend;
  meta.model = ev.model || meta.model;
  meta.workerSessionId = ev.session_id || meta.workerSessionId;
  meta.externalSessionId = ev.external_session_id || meta.externalSessionId;
  if (typeof ev.cost_usd_delta === 'number') {
    meta.costUsd = (meta.costUsd || 0) + ev.cost_usd_delta;
  }
  if (ev.usage) {
    const u = meta.usage || emptyRunMetadata().usage!;
    u.input_tokens += ev.usage.input_tokens || 0;
    u.output_tokens += ev.usage.output_tokens || 0;
    u.cache_creation_input_tokens += ev.usage.cache_creation_input_tokens || 0;
    u.cache_read_input_tokens += ev.usage.cache_read_input_tokens || 0;
    meta.usage = u;
  }
}

function normalizeMetadata(meta: AssistantRunMetadata): AssistantRunMetadata {
  const usage = meta.usage;
  const hasUsage = !!usage && (
    usage.input_tokens > 0 ||
    usage.output_tokens > 0 ||
    usage.cache_creation_input_tokens > 0 ||
    usage.cache_read_input_tokens > 0
  );
  return {
    backend: meta.backend,
    model: meta.model,
    workerSessionId: meta.workerSessionId,
    externalSessionId: meta.externalSessionId,
    costUsd: meta.costUsd && meta.costUsd > 0 ? meta.costUsd : undefined,
    usage: hasUsage ? usage : undefined,
  };
}

export function useAssistantChat(opts: UseAssistantChatOpts = {}) {
  const settingsStore = useCRUD<any>('settings', passthrough, { namespace: NS });
  const connectionStore = useCRUD<any>('connection', passthrough, { namespace: NS });
  const modelStore = useCRUD<any>('model', passthrough, { namespace: NS });

  const { data: settings } = settingsStore.useQuery(SETTINGS_ID);
  const boundModelId = settings?.actionDefaults?.assistant || '';
  const activeModelId = opts.modelId || boundModelId;
  const { data: boundModel } = modelStore.useQuery(activeModelId);
  const connId = boundModel?.connectionId || '';
  const { data: conn } = connectionStore.useQuery(connId);

  const kind = conn?.kind as string | undefined;
  const backend = kindToBackend(kind);
  const cfgDir =
    kind === 'claude-code-cli' && conn?.credentialRef?.locator
      ? resolveConfigDir(String(conn.credentialRef.locator))
      : '';
  const model = boundModel?.remoteId || '';
  // For local-runtime models, the .gguf file path lives on the model
  // row's remoteId (set by the gguf-walk in settings/lib/fetch.ts) —
  // the connection's credentialRef.locator points to the *folder*
  // containing all the gguf files. Pass the model-specific path so
  // local_ai_runtime opens the actual file. expandTilde is defensive
  // against locators that already had a literal tilde resolved from
  // cwd=/ (showing up as "/~/...").
  const modelPath =
    kind === 'local-runtime' && boundModel?.remoteId
      ? expandTilde(String(boundModel.remoteId))
      : '';
  const cwd = processCwd();

  // openai_compat reads endpoint + key from the connection row.
  // credentialRef.source==='env' means locator is the env-var name
  // holding the bearer; otherwise locator is the literal key.
  const baseUrl = backend === 'openai_compat' ? (conn?.endpoint || '') : '';
  const apiKey = useMemo(() => {
    if (backend !== 'openai_compat') return '';
    const cr = conn?.credentialRef;
    if (!cr) return '';
    if (cr.source === 'env') return envGet(String(cr.locator || ''));
    return String(cr.locator || '');
  }, [backend, conn?.credentialRef?.source, conn?.credentialRef?.locator]);

  // CLI backends (claude_code, codex, kimi_cli_wire) handle tools
  // internally — their CLIs run bash/edit/read inside the subprocess
  // and only emit tool_call events for observability. The cart owns
  // tool dispatch ONLY for backends with no CLI to defer to.
  const usesCartTools = backend === 'local_ai' || backend === 'openai_compat';
  const toolsJson = useMemo(
    () => (usesCartTools ? buildToolsSchema() : undefined),
    [usesCartTools],
  );

  // The current thread's backend session id (claude's sid for the
  // claudewrap bridge). Sent as the worker's sessionId → OpenAI `user`
  // field → the bridge's resume key, so this thread keeps its own claude
  // process across turns. Only meaningful for openai_compat; other
  // backends read sessionId differently, so scope it.
  const threadExternalId = useCurrentSessionExternalId();
  const resumeSessionId = backend === 'openai_compat' ? (threadExternalId || '') : '';

  const assistant = useAssistant({
    backend,
    cwd,
    model,
    modelPath,
    sessionId: resumeSessionId,
    configDir: cfgDir,
    // Local model context: pull from the model row's contextLength
    // (set by the gguf-walk / list fetch in settings/lib/fetch.ts), but
    // clamp at 32k. The model registry advertises the model's *trained*
    // window (e.g. 262144 for Gemma-4 / Mistral / Qwen3.6) — passing
    // that straight through to llama.cpp allocates a KV cache big
    // enough to OOM the machine on load. 32k is a sane default for
    // chat; carts that genuinely need more should plumb their own cap.
    nCtx: backend === 'local_ai'
      ? Math.min(Number(boundModel?.contextLength) || 32768, 32768)
      : undefined,
    // Generation cap. The runtime's prior 256-token default truncated
    // every reply mid-sentence; 8192 is enough headroom for a
    // reasoning-heavy local model to think AND respond.
    maxTokens: backend === 'local_ai' ? 8192 : undefined,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    tools: toolsJson,
    persistAcrossUnmount: opts.persistAcrossUnmount,
  });

  useAssistantTools(assistant, { enabled: usesCartTools });

  // Pending-ask bridge: track the assistant_message events that arrive
  // after we sent, accumulate text, fire onPart, resolve on completion.
  const pendingRef = useRef<{
    cursor: number;
    onPart: ((s: string) => void) | null;
    resolve: ((s: string) => void) | null;
    reject: ((e: any) => void) | null;
    accum: string;
    metadata: AssistantRunMetadata;
  } | null>(null);
  const lastRunMetadataRef = useRef<AssistantRunMetadata | null>(null);

  useEffect(() => {
    const p = pendingRef.current;
    if (!p) return;
    const events = assistant.events;
    if (events.length <= p.cursor) return;

    let resolved = false;
    let errored: string | null = null;
    for (let i = p.cursor; i < events.length; i++) {
      const ev = events[i];
      foldMetadata(p.metadata, ev);
      if (ev.kind === 'assistant_message' && ev.role === 'assistant' && typeof ev.text === 'string') {
        p.accum += ev.text;
        if (p.onPart) p.onPart(p.accum);
      } else if (ev.kind === 'completion') {
        resolved = true;
      } else if (ev.kind === 'error_') {
        errored = ev.text || ev.status_text || 'worker error';
      }
    }
    p.cursor = events.length;
    if (resolved) {
      pendingRef.current = null;
      const finalMeta = normalizeMetadata(p.metadata);
      lastRunMetadataRef.current = finalMeta;
      // Persist the backend's session id on this thread so the next turn
      // resumes the same process (claudewrap bridge → claude's sid).
      if (finalMeta.externalSessionId) setCurrentSessionExternalId(finalMeta.externalSessionId);
      p.resolve?.(p.accum);
    } else if (errored) {
      pendingRef.current = null;
      p.reject?.(new Error(errored));
    }
  }, [assistant.events]);

  // Status surface for AssistantChat header — derive from latest
  // status / lifecycle event so the provider's setChatStatus call has
  // something meaningful to publish.
  const lastStatus = useMemo(() => {
    for (let i = assistant.events.length - 1; i >= 0; i -= 1) {
      const ev = assistant.events[i];
      if (ev.kind === 'status' || ev.kind === 'lifecycle') {
        return ev.status_text || ev.text || '';
      }
    }
    return '';
  }, [assistant.events]);

  const ask = (text: string, opts: ChatAskOpts = {}): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!backend) {
        reject(new Error(`unsupported connection kind: ${kind ?? '(none — pick a model in Settings → Actions)'}`));
        return;
      }
      if (assistant.phase === 'failed') {
        reject(new Error(assistant.error ?? 'worker failed'));
        return;
      }
      if (pendingRef.current) {
        reject(new Error('previous ask still pending'));
        return;
      }
      pendingRef.current = {
        cursor: assistant.events.length,
        onPart: opts.onPart || null,
        resolve, reject,
        accum: '',
        metadata: emptyRunMetadata(),
      };
      const ok = assistant.ask(text);
      if (!ok) {
        pendingRef.current = null;
        reject(new Error('worker_send returned false (worker not ready or send failed)'));
      }
    });
  };

  return {
    phase: assistant.phase,
    lastStatus,
    error: assistant.error,
    ask,
    ready: assistant.ready,
    /** Active worker id. Changes whenever useAssistant respawns the
     *  worker (model swap, backend swap, key rotation). The chat
     *  provider compares against its own "last bootstrapped" id to
     *  decide whether to re-prime the new worker with the cart-owned
     *  transcript. */
    workerId: assistant.workerId,
    getLastRunMetadata: () => lastRunMetadataRef.current,
  };
}
