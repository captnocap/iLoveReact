// assist3d/useSceneAssistant — one send path across every backend.
//
// Wraps useAssistant and hides the write mechanism:
//   • claude_code   — the model writes scene.json itself; we just send the
//                     file-write preamble + the request and stay out of the way.
//   • openai_compat — the model calls set_scene; THIS hook writes scene.json from
//     / local_ai      the tool args and responds {ok}. A fenced-JSON fallback
//                     covers models that emit the scene as text instead of a call.
//
// Either way the route calls `send(text)` and the file lands on disk; useAssistScene
// (watching the same path) reloads the surface. The hook owns the preamble-once and
// per-config respawn bookkeeping so the route stays declarative.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistant, type AssistantPhase, type WorkerEvent } from '@reactjit/hooks/useAssistant';
import { fs } from '@reactjit/hooks';
import { parseScene, processCwd, type SceneSpec } from './scene';
import {
  buildAssistantOpts, configReady, firstTurnPreamble, turnReminder, parseToolCall,
  writesOwnFile, type BackendConfig,
} from './backends';

export interface SceneAssistant {
  events: WorkerEvent[];
  phase: AssistantPhase;
  error: string | null;
  ready: boolean;        // config has everything its backend needs
  send: (requestText: string) => boolean;
  /** Last cart-side write outcome (cart-write backends only). */
  note: string | null;
}

// Pull a scene out of a free-text assistant message: a ```json fenced block, or the
// first balanced {...} that mentions "meshes". The fallback for models that print
// the scene instead of calling the tool.
// Strip harmony / chat-template control tokens (Qwen3 etc. emit <|channel|>,
// <|message|>, <|im_start|>…) so they don't break JSON extraction.
function stripMarkup(text: string): string {
  return text.replace(/<\|[^|]*\|>/g, ' ');
}

function extractSceneFromText(raw: string): SceneSpec | null {
  const text = stripMarkup(raw);
  if (text.indexOf('"meshes"') < 0) return null;
  const candidates: string[] = [];
  // every fenced block (a reasoning model may emit several; the scene is usually
  // the last complete one)
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  // the widest balanced-looking {...} as a fallback for un-fenced output
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open >= 0 && close > open) candidates.push(text.slice(open, close + 1));
  // prefer the LAST valid candidate (the model's final answer, not a thinking draft)
  let found: SceneSpec | null = null;
  for (const c of candidates) {
    const s = parseScene(c);
    if (s && s.meshes.length > 0) found = s;
  }
  return found;
}

export function useSceneAssistant(params: { config: BackendConfig; scenePath: string }): SceneAssistant {
  const { config, scenePath } = params;
  const cwd = useMemo(processCwd, []);
  const opts = useMemo(() => buildAssistantOpts(config, cwd), [config, cwd]);
  const assistant = useAssistant(opts);

  const [note, setNote] = useState<string | null>(null);

  // A signature of the spawn-affecting config. When it changes useAssistant
  // respawns a fresh worker, so the preamble must be re-sent on the next turn.
  const sig = useMemo(
    () => JSON.stringify([config.backend, config.model, config.baseUrl, config.apiKey, config.modelPath]),
    [config],
  );
  const sentPreambleRef = useRef(false);
  const lastSigRef = useRef(sig);
  if (lastSigRef.current !== sig) { lastSigRef.current = sig; sentPreambleRef.current = false; }

  // Last scene we wrote (serialized), so streaming deltas that re-extract the same
  // scene don't rewrite the file every token.
  const lastWrittenRef = useRef<string>('');
  const writeScene = (s: SceneSpec): boolean => {
    const json = JSON.stringify(s, null, 2);
    if (json === lastWrittenRef.current) return true; // no change — skip the write
    const ok = fs.writeFile(scenePath, json + '\n');
    if (ok) lastWrittenRef.current = json;
    setNote(ok ? `wrote ${s.meshes.length} meshes` : 'write failed');
    return ok;
  };

  // Cart-write dispatch. Two paths:
  //   • openai_compat — a structured set_scene tool_call; write its args, respond.
  //   • local_ai      — text only (no tool support in the minimal worker). Tokens
  //     stream as many tiny assistant_message events, so we ACCUMULATE them across
  //     the turn and extract the ```json scene from the running buffer. dedupe via
  //     lastWrittenRef so partial buffers that re-parse to the same scene write once.
  // No-op for claude_code, which writes its own file.
  const cursorRef = useRef(0);
  const accumRef = useRef('');
  useEffect(() => {
    if (writesOwnFile(config.backend)) { cursorRef.current = assistant.events.length; return; }
    const events = assistant.events;
    for (let i = cursorRef.current; i < events.length; i++) {
      const ev = events[i];
      if (ev.kind === 'tool_call') {
        const call = parseToolCall(ev.payload_json);
        if (!call) continue;
        if (call.name !== 'set_scene') {
          assistant.respond(call.id, { ok: false, error: `unknown tool: ${call.name}` });
          continue;
        }
        const scene = parseScene(call.input_json);
        if (!scene || scene.meshes.length === 0) {
          assistant.respond(call.id, { ok: false, error: 'no valid meshes in set_scene args' });
          continue;
        }
        const ok = writeScene(scene);
        assistant.respond(call.id, ok ? { ok: true, meshes: scene.meshes.length } : { ok: false, error: 'cart failed to write the scene file' });
      } else if (ev.kind === 'assistant_message' && ev.text) {
        accumRef.current += ev.text;
        const scene = extractSceneFromText(accumRef.current);
        if (scene) writeScene(scene);
      } else if (ev.kind === 'user_message' || ev.kind === 'completion') {
        // turn boundary — one last extraction attempt, then reset the buffer
        if (ev.kind === 'completion') {
          const scene = extractSceneFromText(accumRef.current);
          if (scene) writeScene(scene);
        }
        accumRef.current = '';
      }
    }
    cursorRef.current = events.length;
  }, [assistant.events, config.backend]);

  const send = (requestText: string): boolean => {
    const text = requestText.trim();
    if (!text) return false;
    const msg = sentPreambleRef.current
      ? `${text}\n\n${turnReminder(config, scenePath)}`
      : `${firstTurnPreamble(config, scenePath)}\n\nRequest: ${text}`;
    if (!assistant.ask(msg)) return false;
    sentPreambleRef.current = true;
    return true;
  };

  return {
    events: assistant.events,
    phase: assistant.phase,
    error: assistant.error,
    ready: configReady(config),
    send,
    note,
  };
}
