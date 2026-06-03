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
import { fs, busEmit } from '@reactjit/hooks';
import { parseScene, processCwd, SCENE_WRITTEN_EVENT, type SceneSpec } from './scene';
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

// Strip harmony / chat-template control tokens (Qwen3 etc. emit <|channel|>,
// <|message|>, <|im_start|>…) so they don't break JSON extraction.
function stripMarkup(text: string): string {
  return text.replace(/<\|[^|]*\|>/g, ' ');
}

// Every COMPLETE top-level {...} region, found by brace-depth scanning. This is
// the fix for the gemma case: the model dumped 10K chars of reasoning prose with
// braces in it AND the scene, with no fences. A naive firstBrace…lastBrace grabs
// the prose braces too and yields invalid JSON; depth scanning isolates each
// balanced object so the scene object parses on its own. (Our scene values never
// contain a literal "{" or "}" inside a string, so we don't need string-awareness.)
function balancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
    }
  }
  return out;
}

// Pull a scene out of a free-text reply: fenced ```json blocks first, then every
// balanced {...} region. Returns the candidate that parses to the MOST meshes (the
// real scene, not a tiny draft/example the model mentioned while thinking).
function extractSceneFromText(raw: string): SceneSpec | null {
  const text = stripMarkup(raw);
  if (text.indexOf('"meshes"') < 0) return null;
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  for (const region of balancedObjects(text)) candidates.push(region);
  let best: SceneSpec | null = null, bestN = 0;
  for (const c of candidates) {
    if (c.indexOf('"meshes"') < 0) continue;
    const s = parseScene(c);
    if (s && s.meshes.length > bestN) { best = s; bestN = s.meshes.length; }
  }
  return best;
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
    () => JSON.stringify([config.backend, config.model, config.baseUrl, config.apiKey, config.modelPath, config.nCtx, config.maxTokens]),
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
    if (ok) { lastWrittenRef.current = json; busEmit(SCENE_WRITTEN_EVENT, scenePath); }
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
  // Did THIS turn yield a valid scene? Cleared by send(); checked on completion so
  // a turn that emits no parseable scene (e.g. the model ran past the token limit
  // mid-JSON) reports a visible error instead of silently leaving the old scene.
  const foundThisTurnRef = useRef(false);
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
        foundThisTurnRef.current = true;
        const ok = writeScene(scene);
        assistant.respond(call.id, ok ? { ok: true, meshes: scene.meshes.length } : { ok: false, error: 'cart failed to write the scene file' });
      } else if (ev.kind === 'assistant_message' && ev.text) {
        accumRef.current += ev.text;
        // Only run the (O(n)) extract when this delta closed a brace and the
        // buffer actually mentions meshes — avoids re-scanning the whole growing
        // buffer on every token. The completion branch does a final attempt.
        if (ev.text.indexOf('}') >= 0 && accumRef.current.indexOf('"meshes"') >= 0) {
          const scene = extractSceneFromText(accumRef.current);
          if (scene) { foundThisTurnRef.current = true; writeScene(scene); }
        }
      } else if (ev.kind === 'completion') {
        const scene = extractSceneFromText(accumRef.current);
        if (scene) { foundThisTurnRef.current = true; writeScene(scene); }
        if (!foundThisTurnRef.current) {
          setNote('⚠ no scene in the reply — likely cut off mid-JSON. Try a simpler ask or fewer parts.');
        }
        accumRef.current = '';   // turn done — clear so the next turn starts clean
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
    // New turn: never carry a prior turn's text (or its already-written scene)
    // into this one — that's what made "make a dog" silently keep the cat.
    accumRef.current = '';
    foundThisTurnRef.current = false;
    setNote('generating…');
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
