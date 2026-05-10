# `framework/assistant/` — the assistant subsystem

One directory, one cart-side hook, one worker contract underneath. Every
agent / SDK / local-AI / tool / built-in agent definition lives here.
Nothing else in `framework/` reaches across this boundary; nothing inside
this boundary reaches out except through small, named seams (`log.zig`,
`process.zig`, `pty.zig`, `net/http.zig`, `pg.zig`, `v8_runtime.zig`).

## The cart's view

Two hooks. Pick the one that matches what you want:

- **`useAssistant({ backend, ... })`** — text generation + tool use.
  Drives any of: Claude Code, Codex app-server, Kimi wire, OpenAI-compat,
  local AI (llama.cpp). Returns `{ events, ask, phase, ready, close, ... }`.
  See `runtime/hooks/useAssistant.ts`.

- **`useEmbed({ model, reranker?, storeSlug })`** — local embeddings +
  pgvector retrieval. Returns `{ ready, query, embed, ... }`.
  See `runtime/hooks/useEmbed.ts`.

Anything else (chat, agents, tools, model swap, multi-backend routing) is
a wrapper around `useAssistant`. The hook is the seam.

For batch pipelines that can't live inside React render, there's a small
`runOneTurn(opts, prompt) → Promise<string>` pattern that wraps the
`__worker_*` host fns directly via `runtime/ffi`. See the
`knowledge-graph-construction-with-claude` recipe for the canonical shape.

## Directory map

```
framework/assistant/
├── assistant.md                    ← you are here
│
├── claude_sdk/                     Claude CLI subprocess driver
│   ├── mod.zig                       public surface
│   ├── session.zig                   init / send / poll / close
│   ├── options.zig                   typed config
│   ├── argv.zig                      CLI flag emission (no --mcp-config)
│   ├── parser.zig + buffer.zig       stream-json parsing
│   └── types.zig                     Message / ContentBlock / ResultMsg
│
├── codex_sdk.zig                   Codex app-server stdio SDK
├── kimi_wire_sdk.zig               Kimi Code CLI Wire mode SDK
├── openai_compat_sdk.zig           OpenAI / OpenRouter / LMStudio / Ollama / NanoGPT
│
├── local_ai_runtime.zig            llama.cpp subprocess (Vulkan-safe)
├── local_ai_runtime_old.zig        prior in-process version (kept for diff reference)
├── llama_exports.zig               link-keepalive shim for libllama_ffi.so
│
├── worker_contract.zig             Backend enum + WorkerStore + ingest fns
├── worker_bindings.zig             V8 host fns __worker_* (the bridge)
│
├── tool_framework.zig              concurrency-aware tool execution
├── tools_builtin.zig               bash / file / search tool impls
├── bash_tool.zig                   bash-tool umbrella
├── bash_tool/                        per-concern bash internals
│   ├── tool_name.zig
│   ├── command_semantics.zig
│   ├── comment_label.zig
│   ├── destructive_warning.zig
│   ├── mode_validation.zig
│   ├── sed_parser.zig
│   └── security_validators.zig
│
├── built_in/                       packaged agent definitions
│   ├── explore_agent.zig
│   ├── general_purpose_agent.zig
│   ├── guide_agent.zig
│   ├── plan_agent.zig
│   ├── statusline_agent.zig
│   └── verification_agent.zig
├── built_in_agents.zig             registry that imports the six above
├── agent_definition.zig            AgentDefinition struct (referenced by built_in/*)
├── agent_color_manager.zig         color tokens used by AgentDefinition
├── agent_display.zig               cart-side display metadata
├── agent_memory.zig                + agent_memory_snapshot.zig — memory primitives
│
├── browser.zig                     web automation (umbrella)
├── browser/                          stealth + content extraction
│   ├── content.zig
│   └── stealth.zig
│
├── swarm.zig                       multi-agent team management (umbrella)
├── swarm/
│   ├── constants.zig
│   ├── spawn_utils.zig
│   ├── team_helpers.zig
│   └── backends/types.zig
│
├── embed.zig                       local embedding + pgvector retrieval
│
├── v8_bindings_sdk.zig             registers __http_*, __browse_*, __play_*,
│                                   __ipc_*, __sem_* and the worker host fns
├── v8_bindings_embed.zig           registers __embed_*
│
├── api_types/
│   ├── agent.d.ts                  TS ambient: agent surface
│   └── tools.d.ts                  TS ambient: tools surface
│
├── constants.zig                   shared constants
└── root.zig                        umbrella `pub const` re-exports
```

## The worker contract (Zig + V8)

Every backend funnels through one normalized event stream produced by
`worker_contract.WorkerStore`. The cart never sees provider-shaped
payloads — it reads `WorkerEvent` records.

Six host fns registered by `worker_bindings.register()`:

```text
__worker_start(backend, opts_json)             → worker_id ("" on fail)
__worker_send(worker_id, text)                 → bool
__worker_poll(worker_id)                       → WorkerEvent[] | undefined
__worker_respond(worker_id, request_id, payload_json) → bool
__worker_set_tools(worker_id, tools_json)      → bool
__worker_close(worker_id)                      → void
```

`useAssistant` is a thin React adapter over these fns. `runOneTurn` is a
non-React Promise wrapper over the same fns.

### `WorkerEvent` shape

```typescript
interface WorkerEvent {
  id: number;
  worker_id: string;
  session_id: string;
  backend: AssistantBackend;
  kind:
    | 'lifecycle' | 'context_switch' | 'status'
    | 'user_message' | 'assistant_message' | 'reasoning'
    | 'tool_call' | 'tool_output'
    | 'usage' | 'completion' | 'error_' | 'raw';
  role?: 'system' | 'user' | 'assistant' | 'tool' | 'internal';
  text?: string;
  payload_json?: string;     // backend-shaped JSON for tool_call / raw
  cost_usd_delta?: number;
  usage?: WorkerEventUsage;
  // ...timing + ids
}
```

Reduce this stream into whatever shape your UI wants — `assistant_message`
chunks for streaming text, `tool_call` for invocations, `completion` for
turn boundaries, `error_` for failures.

## Backends

| `backend` value      | SDK file                  | Notes                                       |
|----------------------|---------------------------|---------------------------------------------|
| `claude_code`        | `claude_sdk/`             | Spawns the `claude` CLI in stream-json mode |
| `codex_app_server`   | `codex_sdk.zig`           | Codex app-server stdio                      |
| `kimi_cli_wire`      | `kimi_wire_sdk.zig`       | `kimi --wire` subprocess                    |
| `local_ai`           | `local_ai_runtime.zig`    | llama.cpp subprocess; Vulkan-safe via PID isolation |
| `openai_compat`      | `openai_compat_sdk.zig`   | `/v1/chat/completions` with SSE streaming   |

`worker_bindings.zig` dispatches on `backend`, threads opts JSON into the
right SDK, and pumps the SDK's events through `WorkerStore.ingest` so they
emerge as a normalized `WorkerEvent[]`.

## Tools

`tool_framework.zig` + `tools_builtin.zig` define the model-agnostic tool
execution layer:

- `Tool` struct with `name`, `description`, `input_schema`, `execute`,
  `isConcurrencySafeFn`, `isReadOnlyFn`, `isDestructiveFn`.
- `ToolRegistry` for registration.
- `ToolExecutor` for queued execution with progress callbacks and
  sibling-abort semantics (one bash error cancels other in-flight bashes).

`bash_tool.zig` is the canonical Tool implementation, decomposed under
`bash_tool/` into command-semantics parsing, destructive-op warnings,
sed-parser safety, and security validators.

These run in-process. They are **not** MCP — there is no out-of-process
tool server. The Claude CLI's own built-in tools (Bash / Read / Edit /
Grep / Glob) cover the agent surface for `claude_code`; in-process tools
matter when a backend (e.g. `openai_compat`, `local_ai`) needs them
plumbed via the worker's `tools` opt.

## Built-in agents

`built_in/` packages six agent definitions (`explore`, `general_purpose`,
`guide`, `plan`, `statusline`, `verification`) backed by the
`AgentDefinition` struct in `agent_definition.zig`. `built_in_agents.zig`
is the registry that imports them.

These are agent *definitions* — system prompts + allowed-tool sets +
display metadata — not running agents. They get spawned via the same
worker contract once a cart attaches them to a `useAssistant` mount.

## Embeddings

`embed.zig` is the local embedding + pgvector retrieval engine. Lifted
from `experiments/embed-bench/`; backed by `libllama_ffi` (the link-time
path) and `framework/pg.zig` for storage.

`v8_bindings_embed.zig` registers ten `__embed_*` host fns. `useEmbed`
wraps them; the non-hook typed module is `runtime/hooks/embed.ts`.

Per-`source_type` partial HNSW indexes are required (pgvector 0.5.1 has
no `iterative_scan`) — see the embed-bench memory note.

## V8 bindings

- `v8_bindings_sdk.zig` — registers ~50 host fns covering HTTP
  (`__http_*`), browser (`__browse_*`, `__browser_*`), media playback
  (`__play_*`, `__rec_*`), IPC (`__ipc_*`), and the semantic graph
  (`__sem_*`). Calls into non-assistant modules via `../` (player,
  vterm, debug_client, semantic, classifier, net/*).
- `v8_bindings_embed.zig` — registers the `__embed_*` host fns.
- `worker_bindings.register()` — registers the six `__worker_*` host
  fns. Called from `v8_bindings_sdk.registerSdk()`.

`v8_app.zig` mounts both via `framework/assistant/v8_bindings_{sdk,embed}.zig`
import paths.

## Cross-imports out of `framework/assistant/`

These are the only outward references — keep the count small:

| File                          | Imports                                                |
|-------------------------------|--------------------------------------------------------|
| `v8_bindings_sdk.zig`         | `../v8_runtime`, `../net/http`, `../net/browse_bridge`, `../debug_client`, `../player`, `../vterm`, `../semantic`, `../classifier` |
| `v8_bindings_embed.zig`       | `../v8_runtime`                                        |
| `worker_bindings.zig`         | `../v8_runtime`                                        |
| `codex_sdk.zig`               | `../log`                                               |
| `kimi_wire_sdk.zig`           | `claude_sdk/buffer.zig` (sibling)                      |
| `openai_compat_sdk.zig`       | `../net/http`                                          |
| `local_ai_runtime.zig`        | `../log`, `../net/ring_buffer`                         |
| `local_ai_runtime_old.zig`    | `../net/ring_buffer`                                   |
| `tool_framework.zig`          | `../log`, `../process`, `../pty`                       |
| `tools_builtin.zig`           | `../log`, `../tool_framework` (sibling), `../pty`, `../process` |
| `embed.zig`                   | `../log`, `../pg.zig`, `pg` (zig-pg module)            |
| `built_in/*.zig`              | `../agent_definition.zig` (sibling)                    |

Everything else is sibling-internal.

## C/C++ on the side

Native bits stay in the shared `framework/ffi/` directory because they're
compiled once for the whole framework, not per-subsystem:

- `framework/ffi/llm_worker.cpp` — the subprocess `local_ai_runtime.zig`
  spawns. Talks LOAD/CHAT/READY/TOK/DONE/ERR over stdin/stdout.
- `framework/ffi/llama_headers/` — vendored ggml + llama headers.

## Common patterns

### Interactive cart (one mount, one worker)

```tsx
const { events, ask, ready, close } = useAssistant({
  backend: 'claude_code',
  cwd,
  model: 'claude-opus-4-7',
});

useEffect(() => {
  if (ready() && pendingPrompt) ask(pendingPrompt);
}, [ready(), pendingPrompt]);

const text = useMemo(
  () => events.filter(e => e.kind === 'assistant_message').map(e => e.text ?? '').join(''),
  [events],
);
```

### Reset / compact (bump sessionId)

```tsx
const [epoch, setEpoch] = useState(0);
const a = useAssistant({ backend: 'claude_code', cwd, model, sessionId: `epoch-${epoch}` });
function reset() { setEpoch(n => n + 1); }   // worker respawns; events array starts fresh
```

### Batch pipeline (no React)

```typescript
import { callHost, hasHost } from '@reactjit/runtime/ffi';

async function runOneTurn(opts: { backend: string; cwd?: string; model?: string }, prompt: string): Promise<string> {
  const wid = callHost('__worker_start', opts.backend, JSON.stringify(opts)) as string;
  if (!wid) throw new Error('worker_start failed');
  callHost('__worker_send', wid, prompt);
  let text = '';
  while (true) {
    const events = (callHost('__worker_poll', wid) as any[]) ?? [];
    for (const ev of events) {
      if (ev.kind === 'assistant_message' && ev.text) text += ev.text;
      else if (ev.kind === 'completion') { callHost('__worker_close', wid); return text; }
      else if (ev.kind === 'error_')      { callHost('__worker_close', wid); throw new Error(ev.text || 'error'); }
    }
    await new Promise(r => setTimeout(r, 50));
  }
}
```

### Local AI

```tsx
useAssistant({
  backend: 'local_ai',
  modelPath: '/path/to/model.gguf',
  nCtx: 262144,        // KV-cache size
  maxTokens: 4,        // per-turn cap (tighten for TRUE/FALSE gates)
  systemPrompt: '...',
});
```

### OpenAI-compat (LM Studio / Ollama / OpenRouter)

```tsx
useAssistant({
  backend: 'openai_compat',
  baseUrl: 'http://localhost:1234/v1',
  apiKey: '...',
  model: 'gpt-4',
  systemPrompt: '...',
  tools: '[{"type":"function","function":{...}}]',
});
```

## Open gaps (TODO surface)

Tracked here so they don't get re-discovered every recipe rewrite:

- **No `--beta` flags through `claude_sdk/argv.zig`.** Blocks
  `compact_20260112`, `clear_tool_uses_20250919`, mid-session
  `context_management.edits` from being reachable through `claude_code`.
- **No slash-command path.** The Claude worker passes user text as-is.
  Routing a leading `/` into Claude Code's slash-command surface would
  give carts cart-driven `/clear` and `/compact`.
- **Worker opts for `claude_code` don't accept `allowed_tools` /
  `disallowed_tools` / `systemPrompt` yet.** The fields exist in
  `claude_sdk/options.zig`; wire them into the Claude branch of
  `worker_bindings.zig`.
- **Token usage is partial.** `cache_read_input_tokens` /
  `cache_creation_input_tokens` exist on `WorkerEventUsage` but the
  Claude SDK parser doesn't populate them.
- **`built_in/*.zig` and `agent_definition.zig` aren't wired into any
  build target yet** — `built_in_agents.zig` is the registry but no V8
  binding surfaces it. Defer until the assistant rail wants typed
  agent picker UI.
- **`local_ai_runtime_old.zig` should be deleted** once the subprocess
  path has had a few weeks in production. Kept now as a diff breadcrumb.
- **No PreToolUse hooks** in `SessionOptions` (Claude Code recipes that
  rely on shell hooks like the SRE `DB_POOL_SIZE` blocker can't be
  ported faithfully). Add `hooks` field + `--settings <json>` emission
  if/when this matters.

## What's *not* here (and why)

- **`framework/classifier.zig` + `framework/semantic.zig`** — terminal
  output classification + semantic tree building. Used by
  `v8_bindings_sdk.zig` (assistant) AND `engine.zig` / `pty_remote.zig`
  (non-assistant). Stayed in `framework/` to avoid forcing those callers
  to reach into `assistant/`.
- **`framework/voice.zig` + `framework/whisper.zig`** — speech, separate
  concern. Live under `framework/` (or `framework/audio/` if it grows).
- **MCP** — never landed; not planned. Built-in Claude Code tools cover
  the agent surface for `claude_code`; in-process tools cover the rest.
