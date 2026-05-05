// useAssistant — single agent surface, all backends behind it.
//
// The hook owns one worker (per mount) backed by the unified worker
// bindings in framework/worker_bindings.zig:
//
//   __worker_start(backend, opts_json) → worker_id
//   __worker_send(worker_id, text)
//   __worker_poll(worker_id) → WorkerEvent[]
//   __worker_respond(worker_id, request_id, payload_json)
//   __worker_close(worker_id)
//
// The returned `events` array is the normalized, append-only timeline
// produced by Zig's WorkerStore. Cart code reads from this array and
// never sees provider-shaped data.
//
// Backends supported in Phase 1:
//   - 'claude_code'    — claude CLI subprocess
//   - 'kimi_cli_wire'  — kimi --wire subprocess
//
// 'codex_app_server' is recognized; __worker_start returns "" until its
// V8 bridge lands. Local-runtime arrives once Backend gains the variant.

import { useEffect, useRef, useState } from 'react';
import { callHost, hasHost } from '../ffi';

export type AssistantBackend =
  | 'claude_code'
  | 'codex_app_server'
  | 'kimi_cli_wire'
  | 'local_ai'
  | 'openai_compat';

export type WorkerEventKind =
  | 'lifecycle'
  | 'context_switch'
  | 'status'
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_output'
  | 'usage'
  | 'completion'
  | 'error_'
  | 'raw';

export type WorkerEventRole = 'system' | 'user' | 'assistant' | 'tool' | 'internal';

export interface WorkerEventUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface WorkerEvent {
  id: number;
  worker_id: string;
  session_id: string;
  backend: AssistantBackend;
  kind: WorkerEventKind;
  role?: WorkerEventRole;
  model?: string;
  phase?: string;
  text?: string;
  payload_json?: string;
  turn_id?: string;
  thread_id?: string;
  external_session_id?: string;
  status_text?: string;
  cost_usd_delta?: number;
  usage?: WorkerEventUsage;
  created_at_ms: number;
}

export type AssistantPhase = 'init' | 'starting' | 'idle' | 'streaming' | 'failed' | 'closed';

export interface UseAssistantOpts {
  /** When undefined, the hook stays in 'init' until a backend is set
   *  (e.g. while Settings / Connection rows are still loading). */
  backend?: AssistantBackend;
  cwd?: string;
  model?: string;
  configDir?: string;     // claude_code only
  resumeSession?: string; // claude_code only
  sessionId?: string;     // kimi_cli_wire / local_ai
  yolo?: boolean;         // kimi_cli_wire only
  modelPath?: string;     // local_ai (absolute path to .gguf)
  nCtx?: number;          // local_ai (KV-cache size; default 2048)
  baseUrl?: string;       // openai_compat (e.g. http://localhost:1234/v1)
  apiKey?: string;        // openai_compat (Bearer token)
  systemPrompt?: string;  // openai_compat (initial system message)
  /** Tools schema as a JSON array string. Format follows OpenAI's
   *  `tools:[{type:"function",function:{name,description,parameters}}, …]`.
   *  local_ai's runtime treats this same shape as its TOOLS message. */
  tools?: string;
  pollMs?: number;
  /** When true, the worker stays alive across unmount (dev hot-reload). */
  persistAcrossUnmount?: boolean;
}

export interface UseAssistantResult {
  events: WorkerEvent[];
  phase: AssistantPhase;
  workerId: string | null;
  error: string | null;
  /** Send user text. Returns false if the worker isn't ready. */
  ask: (text: string) => boolean;
  /** Reply to an interactive request the worker emitted. For tool_call
   *  events on local_ai / openai_compat, requestId is the tool_call_id
   *  and payload is the result string the model receives. */
  respond: (requestId: string, payload: unknown) => boolean;
  /** Replace the tools schema mid-session. Most callers pass `tools` on
   *  the initial opts and never need this, but it's exposed for carts
   *  that mutate their tool registry on the fly. */
  setTools: (toolsJson: string) => boolean;
  /** Close the worker and free its session. */
  close: () => void;
  ready: () => boolean;
}

function buildOptsJson(opts: UseAssistantOpts): string {
  const out: Record<string, unknown> = {};
  if (opts.cwd) out.cwd = opts.cwd;
  if (opts.model) out.model = opts.model;
  if (opts.configDir) out.config_dir = opts.configDir;
  if (opts.resumeSession) out.resume_session = opts.resumeSession;
  if (opts.sessionId) out.session_id = opts.sessionId;
  if (opts.yolo !== undefined) out.yolo = opts.yolo;
  if (opts.modelPath) out.model_path = opts.modelPath;
  if (opts.nCtx !== undefined) out.n_ctx = opts.nCtx;
  if (opts.baseUrl) out.base_url = opts.baseUrl;
  if (opts.apiKey) out.api_key = opts.apiKey;
  if (opts.systemPrompt) out.system_prompt = opts.systemPrompt;
  if (opts.tools) out.tools_json = opts.tools;
  return JSON.stringify(out);
}

function derivePhase(events: WorkerEvent[]): AssistantPhase {
  if (events.length === 0) return 'starting';
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.kind === 'completion') return 'idle';
    if (ev.kind === 'error_') return 'failed';
    if (ev.kind === 'assistant_message' || ev.kind === 'reasoning' || ev.kind === 'tool_call') {
      return 'streaming';
    }
    if (ev.kind === 'user_message') return 'streaming';
  }
  return 'idle';
}

export function useAssistant(opts: UseAssistantOpts): UseAssistantResult {
  const [phase, setPhase] = useState<AssistantPhase>('init');
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<WorkerEvent[]>([]);
  const [workerId, setWorkerId] = useState<string | null>(null);

  const phaseRef = useRef<AssistantPhase>('init');
  const workerIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    // Lazy spawn: settings/connection rows load async, so the first
    // render usually has empty backend/cwd/model. We re-run on opts
    // change and start the worker once required fields arrive.
    if (!startedRef.current) {
      if (!opts.backend) return;
      // openai_compat is HTTP — needs base_url + model, no cwd.
      // Every other backend is subprocess-driven and needs cwd.
      if (opts.backend === 'openai_compat') {
        if (!opts.baseUrl || !opts.model) return;
      } else {
        if (!opts.cwd) return;
        // codex_app_server / kimi_cli_wire resolve their own model from
        // their CLI configs; claude_code / local_ai need an explicit
        // model or modelPath.
        const needsModel = opts.backend === 'claude_code' || opts.backend === 'local_ai';
        if (needsModel && !opts.model && !opts.modelPath) return;
      }

      if (!hasHost('__worker_start')) {
        setError('worker host bindings not registered (framework/worker_bindings.zig)');
        phaseRef.current = 'failed';
        setPhase('failed');
        return;
      }

      const id = callHost<string>('__worker_start', '', opts.backend, buildOptsJson(opts));
      if (!id) {
        setError(`__worker_start returned empty for backend=${opts.backend} (unsupported / spawn failed)`);
        phaseRef.current = 'failed';
        setPhase('failed');
        return;
      }

      startedRef.current = true;
      workerIdRef.current = id;
      setWorkerId(id);
      phaseRef.current = 'starting';
      setPhase('starting');
    }

    const pollMs = opts.pollMs ?? 100;
    const interval = setInterval(() => {
      const wid = workerIdRef.current;
      if (!wid) return;
      const batch = callHost<WorkerEvent[] | undefined>('__worker_poll', undefined, wid);
      if (!batch || batch.length === 0) return;
      setEvents((prev) => {
        const next = prev.concat(batch);
        const nextPhase = derivePhase(next);
        if (nextPhase !== phaseRef.current) {
          phaseRef.current = nextPhase;
          setPhase(nextPhase);
        }
        return next;
      });
    }, pollMs) as unknown as number;

    return () => {
      clearInterval(interval as any);
      if (opts.persistAcrossUnmount === false) {
        const wid = workerIdRef.current;
        if (wid && hasHost('__worker_close')) {
          callHost<void>('__worker_close', undefined as any, wid);
        }
        workerIdRef.current = null;
        startedRef.current = false;
        phaseRef.current = 'closed';
        setPhase('closed');
        setWorkerId(null);
      }
    };
  }, [opts.backend, opts.cwd, opts.model, opts.modelPath, opts.nCtx, opts.configDir, opts.resumeSession, opts.sessionId, opts.yolo, opts.baseUrl, opts.apiKey, opts.systemPrompt, opts.pollMs]);

  const ask = (text: string): boolean => {
    const wid = workerIdRef.current;
    if (!wid || !hasHost('__worker_send')) return false;
    return callHost<boolean>('__worker_send', false, wid, text);
  };

  const respond = (requestId: string, payload: unknown): boolean => {
    const wid = workerIdRef.current;
    if (!wid || !hasHost('__worker_respond')) return false;
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return callHost<boolean>('__worker_respond', false, wid, requestId, json);
  };

  const setTools = (toolsJson: string): boolean => {
    const wid = workerIdRef.current;
    if (!wid || !hasHost('__worker_set_tools')) return false;
    return callHost<boolean>('__worker_set_tools', false, wid, toolsJson);
  };

  const close = (): void => {
    const wid = workerIdRef.current;
    if (!wid) return;
    if (hasHost('__worker_close')) callHost<void>('__worker_close', undefined as any, wid);
    workerIdRef.current = null;
    startedRef.current = false;
    phaseRef.current = 'closed';
    setPhase('closed');
    setWorkerId(null);
  };

  const ready = (): boolean => phaseRef.current !== 'init' && phaseRef.current !== 'starting' && phaseRef.current !== 'failed' && phaseRef.current !== 'closed';

  return { events, phase, workerId, error, ask, respond, setTools, close, ready };
}
