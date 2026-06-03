// assist3d/backends.ts — the per-backend differences, in one place.
//
// useAssistant already speaks claude_code / openai_compat / local_ai. What differs
// here is HOW the scene file gets written:
//
//   • claude_code   — a real claude subprocess; it OVERWRITES scene.json itself
//                     with its Write tool. The cart never touches the file.
//   • openai_compat — an HTTP chat model (any OpenAI-compatible endpoint). It can't
//                     touch disk, so it calls a `set_scene` tool; the CART writes
//                     scene.json from the tool args.
//   • local_ai      — an embedded llama.cpp GGUF. Same as openai_compat: it emits
//                     set_scene and the cart writes the file.
//
// So claude self-writes; HTTP/local are "cart-write". useSceneAssistant routes on
// writesOwnFile() and either lets claude write or writes the file itself.

import type { UseAssistantOpts } from '@reactjit/hooks/useAssistant';
import { ALLOWED_GEOMETRY, SCENE_SCHEMA_TEXT, SCENE_RULES, buildPreamble } from './scene';

export type Backend = 'claude_code' | 'openai_compat' | 'local_ai';

export interface BackendConfig {
  backend: Backend;
  model?: string;       // claude_code / openai_compat model id; local_ai display name
  baseUrl?: string;     // openai_compat endpoint (…/v1)
  apiKey?: string;      // openai_compat bearer
  modelPath?: string;   // local_ai absolute .gguf path
}

export const BACKEND_LABELS: Record<Backend, string> = {
  claude_code: 'Claude',
  openai_compat: 'HTTP',
  local_ai: 'Local GGUF',
};

// Sensible starting points for each backend's config (the UI prefills these).
export const DEFAULT_CONFIG: Record<Backend, BackendConfig> = {
  claude_code: { backend: 'claude_code', model: 'claude-opus-4-7' },
  // Default to claudewrap's local OpenAI-compat bridge — free under the user's
  // Max subscription, no API tokens. Any other …/v1 endpoint + key works too.
  openai_compat: { backend: 'openai_compat', baseUrl: 'http://localhost:7781/v1', apiKey: 'bridge', model: 'disk-claude' },
  local_ai: { backend: 'local_ai', modelPath: '', model: 'local' },
};

// claude_code writes scene.json itself; everyone else hands us structured output.
export function writesOwnFile(b: Backend): boolean {
  return b === 'claude_code';
}

// The single tool the cart-write backends call to (re)author the whole scene.
// One tool, full-scene replacement — no diffs, so the model never has to reason
// about patching JSON it can't see.
export const SET_SCENE_TOOL = JSON.stringify([
  {
    type: 'function',
    function: {
      name: 'set_scene',
      description:
        'Create or replace the ENTIRE 3D scene. Always pass the FULL set of meshes ' +
        '(not a diff) — the scene becomes exactly what you pass. Call this to apply ' +
        'any create/edit the user asks for.',
      parameters: {
        type: 'object',
        properties: {
          background: { type: 'string', description: 'hex background colour, e.g. "#0a111d"' },
          meshes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'short unique lowercase id' },
                geometry: { type: 'string', enum: [...ALLOWED_GEOMETRY] },
                params: { type: 'object', description: 'geometry params, e.g. {"radius":0.5,"height":2}' },
                material: { type: 'string', description: 'hex colour, e.g. "#3f8a4a"' },
                position: { type: 'array', items: { type: 'number' }, description: '[x,y,z], +Y up, 1 unit = 1m' },
                rotation: { type: 'array', items: { type: 'number' }, description: '[degX,degY,degZ]' },
              },
              required: ['id', 'geometry', 'material', 'position'],
            },
          },
        },
        required: ['meshes'],
      },
    },
  },
]);

// Instruction preamble for the cart-write backends (call the tool, don't write a
// file). Shares the schema + rules with claude's file-write preamble.
export function buildToolPreamble(): string {
  return [
    'You drive a live, hot-reloaded 3D viewer by calling ONE tool: set_scene.',
    'Whenever I ask for a scene or an edit, call set_scene with the FULL scene (every',
    'mesh, not a diff). The scene becomes exactly what you pass.',
    '',
    SCENE_SCHEMA_TEXT,
    '',
    SCENE_RULES,
    '',
    'Always APPLY changes by calling set_scene — do not just describe them in prose.',
  ].join('\n');
}

// Instruction preamble for local GGUFs. The minimal rjit-llm-worker is built
// WITHOUT --with-tools, so a local model can't emit a structured tool call — it
// only streams text. So we ask for the scene as a fenced ```json block and the
// cart extracts it (useSceneAssistant's text path). Reasoning models may think
// first; the extractor ignores the thinking and reads the JSON.
export function buildJsonPreamble(): string {
  return [
    'You drive a live, hot-reloaded 3D viewer. When I ask for a scene or an edit,',
    'output the FULL scene (every mesh, not a diff) as ONE fenced ```json code block.',
    'The scene becomes exactly what that block contains.',
    '',
    SCENE_SCHEMA_TEXT,
    '',
    SCENE_RULES,
    '',
    'Your final answer MUST be a single ```json … ``` block and nothing after it.',
    'Do not describe the scene in prose — just emit the JSON block.',
  ].join('\n');
}

// Build the useAssistant opts for a config. cwd is needed for claude_code's
// subprocess; scenePath for claude's file-write preamble (sent per-turn, not here).
export function buildAssistantOpts(config: BackendConfig, cwd: string): UseAssistantOpts {
  switch (config.backend) {
    case 'claude_code':
      return { backend: 'claude_code', cwd, model: config.model || 'claude-opus-4-7', persistAcrossUnmount: true };
    case 'openai_compat':
      return {
        backend: 'openai_compat',
        baseUrl: config.baseUrl || '',
        apiKey: config.apiKey || 'x',
        model: config.model || '',
        systemPrompt: buildToolPreamble(),
        tools: SET_SCENE_TOOL,
        persistAcrossUnmount: true,
      };
    case 'local_ai':
      // No default `model`: useAssistant's spawn gate is `model || modelPath`, so
      // omitting model means it waits for a real .gguf path before spawning.
      // No `tools` either — the minimal worker has no tool support; it emits a
      // ```json block instead (buildJsonPreamble), which the cart extracts.
      return {
        backend: 'local_ai',
        cwd,
        modelPath: config.modelPath || '',
        // Reasoning models burn a lot of tokens thinking BEFORE the JSON — a
        // "detailed" ask overran the old 4096 cap mid-scene. Give the buffer room
        // (and the context to hold the running session) so the JSON completes.
        nCtx: 16384,
        maxTokens: 8192,
        sessionId: 'assist3d',
        persistAcrossUnmount: true,
      };
  }
}

// True once the config carries everything its backend needs to spawn a worker —
// drives the "needs config" hint in the UI.
export function configReady(c: BackendConfig): boolean {
  if (c.backend === 'openai_compat') return !!(c.baseUrl && c.model);
  if (c.backend === 'local_ai') return !!c.modelPath;
  return true; // claude_code resolves cwd itself
}

// The first-turn instruction per backend: claude writes the file, openai_compat
// calls the set_scene tool, local_ai emits a ```json block.
export function firstTurnPreamble(config: BackendConfig, scenePath: string): string {
  if (config.backend === 'claude_code') return buildPreamble(scenePath);
  if (config.backend === 'openai_compat') return buildToolPreamble();
  return buildJsonPreamble();
}

// Per-turn reminder appended after the first turn.
export function turnReminder(config: BackendConfig, scenePath: string): string {
  if (config.backend === 'claude_code') return `(Overwrite the whole scene file at ${scenePath}.)`;
  if (config.backend === 'openai_compat') return '(Apply this by calling set_scene with the full scene.)';
  return '(Reply with the full updated scene as one ```json block.)';
}

interface ToolCall { id: string; name: string; input_json: string }

// Decode a tool_call WorkerEvent's payload (openai_compat / local_ai shape).
export function parseToolCall(payload_json: string | undefined): ToolCall | null {
  if (!payload_json) return null;
  try {
    const obj = JSON.parse(payload_json);
    if (typeof obj?.id !== 'string' || typeof obj?.name !== 'string') return null;
    return { id: obj.id, name: obj.name, input_json: typeof obj.input_json === 'string' ? obj.input_json : '{}' };
  } catch {
    return null;
  }
}
