// Bridges the unified worker contract's tool_call events to the cart's
// existing tool dispatcher. Drop-in after useAssistant — for every
// tool_call WorkerEvent the worker emits (local_ai or openai_compat),
// we parse the payload, run the tool through invokeTool (permission-
// gated), and push the result back via assistant.respond.
//
// Usage:
//   const assistant = useAssistant({ backend, tools: JSON.stringify([…]), … });
//   useAssistantTools(assistant);

import { useEffect, useRef } from 'react';
import type { WorkerEvent } from '@reactjit/runtime/hooks/useAssistant';
import { invokeTool } from './dispatch';

export interface AssistantToolHandle {
  events: WorkerEvent[];
  respond: (requestId: string, payload: unknown) => boolean;
}

interface ToolCallPayload {
  id: string;
  name: string;
  /** JSON string. The dispatcher reads `args` after JSON.parse. */
  input_json: string;
}

function parseToolCallPayload(payload_json: string | undefined): ToolCallPayload | null {
  if (!payload_json) return null;
  try {
    const obj = JSON.parse(payload_json);
    if (typeof obj?.id !== 'string' || typeof obj?.name !== 'string') return null;
    const input = typeof obj.input_json === 'string' ? obj.input_json : '{}';
    return { id: obj.id, name: obj.name, input_json: input };
  } catch {
    return null;
  }
}

export function useAssistantTools(assistant: AssistantToolHandle) {
  // Cursor over the event stream so we only dispatch each tool_call once.
  const cursorRef = useRef(0);
  // Track in-flight call ids so a re-render while awaiting doesn't kick
  // off the same dispatch twice.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const events = assistant.events;
    if (events.length <= cursorRef.current) return;
    for (let i = cursorRef.current; i < events.length; i += 1) {
      const ev = events[i];
      if (ev.kind !== 'tool_call') continue;
      const payload = parseToolCallPayload(ev.payload_json);
      if (!payload) continue;
      if (inFlightRef.current.has(payload.id)) continue;
      inFlightRef.current.add(payload.id);

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(payload.input_json);
      } catch {
        // Malformed args — surface as an error result the model can read.
      }

      void invokeTool({ name: payload.name, args })
        .then((result) => {
          assistant.respond(payload.id, JSON.stringify(result));
        })
        .catch((e: any) => {
          assistant.respond(payload.id, JSON.stringify({
            ok: false,
            error: e?.message ?? String(e),
          }));
        })
        .finally(() => {
          inFlightRef.current.delete(payload.id);
        });
    }
    cursorRef.current = events.length;
  }, [assistant.events]);
}
