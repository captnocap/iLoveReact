# llama.cpp Pipeline (V8 Runtime)

ReactJIT has two llama.cpp-backed V8 paths, and they are intentionally not the
same runtime:

- `useLocalChat` is local text generation. It goes through the SDK host binding
  gate, spawns a separate `rjit-llm-worker` process, and streams tokens over a
  tiny stdin/stdout protocol.
- `useEmbed` / `embed.ts` is local embedding, reranking, ingest, and pgvector
  retrieval. It goes through the embed host binding gate, links
  `libllama_ffi.so` into the cart process, and stores vectors in embedded
  Postgres.

Both paths consume local `.gguf` model files. Neither path uses the DOM,
browser fetch, Web Workers, remote APIs, Ollama, or LM Studio as a server.

Note on runtime scope: the active V8 path for local llama.cpp inference is
`useAssistant({ backend: 'local_ai', modelPath, nCtx, … })`, which calls
`__worker_start('local_ai', …)` registered by `framework/worker_bindings.zig`
(see `docs/v8/worker_contract.md`). The direct `__localai_init` /
`__localai_send` / `__localai_poll` / `__localai_close` globals documented
below are registered only on the QuickJS runtime
(`framework/qjs_runtime.zig:3163-3166`) and are not exposed to V8. The
`useLocalChat` hook described in the rest of this doc is no longer present in
`runtime/hooks/`; its responsibilities live in `runtime/hooks/useAssistant.ts`
on the V8 path. The lower-level shapes (LocalChatPhase, ToolDefinition, event
kinds) and the underlying `framework/local_ai_runtime.zig` runtime described
below are still accurate.

## Public API

### `useLocalChat`

Import:

```ts
import { useLocalChat } from '@reactjit/runtime/hooks/useLocalChat';
```

Shape:

```ts
type LocalChatPhase =
  | 'init'
  | 'loading'
  | 'loaded'
  | 'generating'
  | 'idle'
  | 'failed';

type ToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: any) => any | Promise<any>;
};

type UseLocalChatOpts = {
  model: string;                 // local .gguf path; empty string is inert
  sessionId?: string;
  cwd?: string;                  // used to resolve relative model paths
  nCtx?: number;                 // token context; default 2048
  pollMs?: number;               // background poll interval; default 100
  persistAcrossUnmount?: boolean; // currently cleanup closes the session
  tools?: ToolDefinition[];
};

type ToolCallEvent = {
  id: string;
  name: string;
  args: any;
};

type UseLocalChatResult = {
  phase: LocalChatPhase;
  ready: boolean;
  error: string | null;
  lastStatus: string;
  pulse: number;
  streaming: string;
  ask: (text: string) => Promise<string>;
  isAvailable: () => boolean;
  toolCalls: ToolCallEvent[];
  clearToolCalls: () => void;
};
```

Minimal chat:

```tsx
const chat = useLocalChat({
  model: '/home/me/models/Qwen3.6-27B-Q4_K_M.gguf',
  nCtx: 4096,
});

async function run() {
  if (!chat.ready) return;
  const reply = await chat.ask('Summarize this file in one paragraph.');
}
```

Tool calling:

```tsx
const tools = [{
  name: 'read_file',
  description: 'Read a UTF-8 file from disk.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  execute: ({ path }: { path: string }) => fs.readFile(path),
}];

const chat = useLocalChat({ model: MODEL, tools, nCtx: 65536 });
```

The model receives tool schemas through llama.cpp chat templates. If it emits a
tool call, the worker pauses generation, `useLocalChat` runs the matching JS
executor, sends the result back to the worker, and generation resumes.

### Local Chat Host Functions

Registered by `framework/v8_bindings_sdk.zig`:

```ts
__localai_init(cwd: string, modelPath: string, sessionId?: string, nCtx?: number): boolean;
__localai_send(text: string): boolean;
__localai_poll(): LocalAiEvent | undefined;
__localai_close(): void;
__localai_set_tools(toolsJson: string): boolean;
__localai_send_tool_result(id: string, body: string): boolean;
```

Event shapes returned from `__localai_poll()`:

```ts
type LocalAiEvent =
  | { kind: 'system'; model?: string; session_id?: string }
  | { kind: 'status'; text?: string; is_error: boolean }
  | { kind: 'assistant_part'; part_type: 'text'; text?: string }
  | { kind: 'tool_call'; id?: string; name?: string; args?: string }
  | { kind: 'result'; text?: string; is_error: boolean };
```

`useLocalChat.ask()` allows only one in-flight request per hook. The binding
currently submits only text; per-request `system_prompt` and `max_tokens` exist
in `framework/local_ai_runtime.zig`, but `__localai_send` does not expose them.
Current carts that need a system prompt prepend it to the first user message.

### `embed.ts`

Importing `runtime/hooks/embed.ts` trips the embed build gate:

```ts
import * as embed from '@reactjit/runtime/hooks/embed';
```

Core model and retrieval API:

```ts
type EmbedHandle = number;
type StoreHandle = number;

type ChunkRow = {
  id: string;
  source_type: string;       // code-chunk | chat-log-chunk | document-chunk | ...
  source_id: string;
  chunk_index: number;
  display_text: string;
  text_preview: string;
  metadata_json: string;
  model: string;
  text_sha: string;
  vector: number[];
};

type SearchHit = {
  id: string;
  source_id: string;
  chunk_index: number;
  display_text: string;
  text_preview: string;
  dense_score: number;
  rerank_score?: number;
};

isAvailable(): boolean;
loadModel(ggufPath: string): EmbedHandle;
freeModel(handle: EmbedHandle): void;
nDim(handle: EmbedHandle): number;
embedText(handle: EmbedHandle, text: string): number[] | null;
embedBatch(handle: EmbedHandle, texts: string[]): number[][];
rerank(rerankerGgufPath: string, query: string, candidates: string[]): number[];
openStore(slug: string, dim: number): StoreHandle;
closeStore(handle: StoreHandle): void;
upsert(handle: StoreHandle, row: ChunkRow): boolean;
search(handle: StoreHandle, qvec: number[], n: number, sourceType?: string): SearchHit[];
```

Ingest API:

```ts
type EmbedKind =
  | 'code'
  | 'claude'
  | 'claude-overflow'
  | 'codex'
  | 'kimi'
  | 'memory';

type IngestStartOpts = {
  modelPath: string;
  slug: string;
  kind: EmbedKind;
  nWorkers: number;
};

type IngestProgress = {
  running: boolean;
  files_total: number;
  files_done: number;
  chunks_done: number;
  embed_ms_sum: number;
  current_file: string;
  done: boolean;
  cancelled: boolean;
  error: string;
};

ingestStart(rootPath: string, opts: IngestStartOpts): boolean;
ingestProgress(): IngestProgress;
ingestCancel(): boolean;
```

### `useEmbed`

Import:

```ts
import { useEmbed } from '@reactjit/runtime/hooks/useEmbed';
```

Shape:

```ts
type UseEmbedOpts = {
  model: string;      // embedding .gguf path
  reranker?: string;  // optional reranker .gguf path
  storeSlug: string;  // table suffix: chunks_<storeSlug>
};

type QueryOpts = {
  k?: number;
  topn?: number;
  sourceType?: string;
};

type UseEmbedResult = {
  ready: boolean;
  error: string | null;
  nDim: () => number;
  embed: (text: string) => number[] | null;
  embedBatch: (texts: string[]) => number[][];
  query: (text: string, opts?: QueryOpts) => SearchHit[];
  upsert: (row: ChunkRow) => boolean;
  ingest: IngestProgress;
  startIngest: (rootPath: string, nWorkers?: number, kind?: EmbedKind) => boolean;
  cancelIngest: () => boolean;
};
```

Minimal query:

```tsx
const rag = useEmbed({
  model: '/home/me/models/Qwen3-Embedding-0.6B-Q8_0.gguf',
  reranker: '/home/me/models/Qwen3-Reranker-0.6B-Q8_0.gguf',
  storeSlug: 'qwen3-embedding-0-6b-q8_0',
});

const hits = rag.query('how does the local chat worker load models?', {
  k: 5,
  topn: 30,
  sourceType: 'code-chunk',
});
```

## Build Gates And Packaging

### Chat Generation Gate

`sdk/dependency-registry.json` maps `runtime/hooks/useLocalChat.ts` to the
`sdk` feature. That passes `-Dhas-sdk=true`, which compiles
`framework/v8_bindings_sdk.zig` and registers the `__localai_*` functions.

When `WANT_SDK=1`, `scripts/ship` also tries to bundle:

- `zig-out/bin/rjit-llm-worker`
- `deps/llama.cpp-fresh/build/bin/libllama.so*`
- `libggml.so*`
- `libggml-base.so*`
- `libggml-cpu.so*`
- `libggml-vulkan.so*`

The worker is built separately with:

```sh
./scripts/build-llm-worker.sh
```

That script expects a built upstream checkout at `deps/llama.cpp-fresh` and
writes `zig-out/bin/rjit-llm-worker`.

### Embed/RAG Gate

`runtime/hooks/embed.ts` and `runtime/hooks/useEmbed.ts` trigger the `embed`
feature. `has-embed` implies `has-pg`.

`build.zig` links the cart against `libllama_ffi.so` and sets `$ORIGIN` rpaths.
It prefers:

```text
zig-out/lib/libllama_ffi.so
```

and falls back to:

```text
tsz/zig-out/lib/libllama_ffi.so
```

The embed path also compiles the Postgres binding because vector storage rides
`framework/pg.zig` and embedded Postgres.

## Local Chat End-To-End

1. The cart imports `useLocalChat`.

   `scripts/ship` sees `runtime/hooks/useLocalChat.ts` in the esbuild metafile,
   flips the SDK build gate, and packages the worker plus llama.cpp shared
   libraries if they are present.

2. V8 registers the SDK host surface.

   `v8_app.zig` imports `framework/v8_bindings_sdk.zig` when
   `build_options.has_sdk` is true. The ingredient table registers SDK host
   functions at startup. There is also a direct `v8_bindings_sdk.registerSdk({})`
   call in `appInit`; it installs the same functions a second time when SDK is
   compiled in.

3. `useLocalChat` initializes once per non-empty model path.

   The hook checks `hasHost('__localai_init')`, then calls:

   ```ts
   __localai_init(cwd, modelPath, sessionId, nCtx)
   ```

   Empty `model` is inert. `useAssistantChat` relies on that to call
   `useLocalChat` unconditionally while only activating it for
   `Connection.kind === 'local-runtime'`.

4. `hostLocalAiInit` creates the native session.

   `framework/v8_bindings_sdk.zig` copies `cwd`, `model`, optional
   `sessionId`, and optional `nCtx`, then calls:

   ```zig
   local_ai_runtime.Session.create(std.heap.c_allocator, opts)
   ```

   The session is stored in the process-global `g_local_ai_session`. There is
   one local chat session per cart process.

5. `Session.create` starts the worker thread.

   `framework/local_ai_runtime.zig` owns:

   - `requests: RingBuffer(Request, 32)`
   - `events: RingBuffer(OwnedEvent, 1024)`
   - `tool_replies: RingBuffer(ToolReply, 16)`
   - one Zig worker thread that owns the child process pipes.

6. The Zig worker resolves and spawns `rjit-llm-worker`.

   Worker binary lookup order:

   1. `RJIT_LLM_WORKER`
   2. `<exe_dir>/rjit-llm-worker`
   3. `<exe_dir>/../lib/rjit-llm-worker`
   4. repo dev fallback `zig-out/bin/rjit-llm-worker`

   Before spawn, Zig builds `LD_LIBRARY_PATH` from:

   - `<worker_dir>/lib`
   - repo dev fallback `deps/llama.cpp-fresh/build/bin`
   - existing `LD_LIBRARY_PATH`

7. Zig sends `LOAD`.

   The parent writes:

   ```text
   LOAD <n_ctx> <resolved-model-path>
   ```

   `resolveModelPathAlloc` accepts absolute paths as-is and joins relative paths
   against `cwd` when provided. It does not expand `~`.

8. The C++ worker loads the model.

   `framework/ffi/llm_worker.cpp` calls:

   - `ggml_backend_load_all()`
   - `llama_model_load_from_file(path, params)` with `n_gpu_layers = 99`
   - `llama_init_from_model(model, params)` with `n_ctx` and `n_batch`
   - sampler chain: min-p, temperature, dist seed
   - `common_chat_templates_init(model, "")` to use the GGUF embedded template

   On success it emits:

   ```text
   READY
   ```

   Zig converts that into a `system` event plus `status: "local model ready"`.
   The hook polls those events and moves from `loading` to `loaded`.

9. `ask(text)` submits one request.

   The hook rejects if another `ask()` is still in flight, clears the streaming
   buffer, and calls:

   ```ts
   __localai_send(text)
   ```

   `hostLocalAiSend` pushes a `.chat` request into the session ring buffer.

10. The worker thread writes a `CHAT` command.

   Before each request, Zig flushes pending tools if `__localai_set_tools`
   changed them:

   ```text
   TOOLS
   <json array>
   .
   ```

   Then it writes:

   ```text
   CHAT <max_tokens>
   <system_prompt>
   .
   <user_text>
   .
   ```

   The binding path uses the default `max_tokens = 256` and empty
   `system_prompt` because `__localai_send` exposes only `text`.

11. The C++ worker renders the chat template and streams tokens.

   The worker keeps `history` and `prev_len`. For each turn it applies the
   model's chat template with history, registered tools, and a generation
   prompt. It sends only the prompt delta since `prev_len` through llama.cpp.

   Generation loop:

   - tokenize the prompt delta
   - `llama_decode`
   - sample the next token
   - `llama_token_to_piece`
   - emit escaped token text:

     ```text
     TOK <piece>
     ```

   Zig receives each `TOK`, unescapes `\n` and `\\`, pushes
   `assistant_part`, and appends it to the final assistant buffer. The hook
   appends `assistant_part.text` into `streaming`.

12. Tool calls round-trip through JS.

   After a generated assistant turn, the worker parses model output with
   `common_chat_parse`. If upstream parsing finds no tools, it also runs a
   HauhauCS XML fallback for models that emit:

   ```xml
   <tool_call>
   <function=...>
   <parameter=...>...</parameter>
   </function>
   </tool_call>
   ```

   For each parsed call, the worker emits:

   ```text
   TOOL_CALL <id>
   <name>
   <arguments_json>
   .
   ```

   Zig converts that to a `tool_call` event. `useLocalChat` looks up the named
   tool, executes it, and calls:

   ```ts
   __localai_send_tool_result(id, resultBody)
   ```

   The Zig worker waits for the matching reply, writes:

   ```text
   TOOL_RESULT <id>
   <result_text>
   .
   ```

   and the C++ worker appends a `tool` history turn. Tool generation can loop
   for up to eight rounds before the worker emits an error.

13. Completion resolves the JS promise.

   Normal completion emits:

   ```text
   DONE
   ```

   Zig pushes a `result` event carrying the full assistant buffer. The hook
   resolves the `ask()` promise, clears `streaming`, and moves to `idle`.

14. Cleanup closes the worker.

   On hook cleanup or `__localai_close`, the session flips `should_stop`, joins
   the Zig worker thread, writes `QUIT` when possible, kills the child as a
   fallback, drains owned events, and frees copied strings.

## Embed/RAG End-To-End

1. The cart imports `useEmbed` or `embed.ts`.

   `scripts/ship` sees the import, passes `-Dhas-embed=true`, also passes
   `-Dhas-pg=true`, and records both `embed.flag` and `pg.flag` in the V8
   ingredient manifest.

2. V8 registers embed host functions.

   `v8_app.zig` imports `framework/v8_bindings_embed.zig` when
   `build_options.has_embed` is true. `registerEmbed` installs the
   `__embed_*` functions.

3. The hook loads model and opens store.

   `useEmbed` calls:

   ```ts
   __embed_load_model(modelPath)
   __embed_n_dim(handle)
   __embed_store_open(storeSlug, dim)
   ```

   `framework/v8_bindings_embed.zig` uses global slots:

   - `g_shared: ?embed.SharedModel`
   - `g_query_ctx: ?embed.WorkerCtx`
   - `g_reranker: ?embed.Reranker`
   - `g_store: ?embed.Store`
   - `g_ingest: ?*embed.IngestSession`

   The numeric handles in TS are currently logical handles; the Zig binding
   ignores them and operates on the single process-global slots.

4. `SharedModel` loads llama weights once.

   `framework/embed.zig` calls `llama_backend_init`, sets
   `n_gpu_layers = 999`, and loads the `.gguf` with
   `llama_model_load_from_file`. It stores the model pointer, vocab pointer,
   and `llama_model_n_embd`.

5. Query embedding creates a lazy context.

   The first `__embed_text` or `__embed_batch` creates `g_query_ctx` from the
   shared model with:

   - `n_ctx = 8192`
   - `n_batch = n_ctx`
   - `n_ubatch = 256`
   - `embeddings = true`
   - `pooling_type = 0`
   - `no_perf = true`

6. Text becomes an L2-normalized vector.

   For single text and batched text:

   - llama tokenization probes required token count
   - oversize text is capped to context limits
   - `llama_memory_clear` resets KV memory
   - a `llama_batch` is filled with sequence ids and final-token logits flags
   - `llama_decode` runs the embedding pass
   - `llama_synchronize` blocks until GPU work is complete
   - `llama_get_embeddings_seq` or `llama_get_embeddings` returns raw floats
   - Zig L2-normalizes the vector before returning JSON to JS

   Dense cosine search can then use dot product semantics.

7. Store open creates the per-model pgvector table.

   `embed.Store.open` uses `framework/pg.zig`'s default pool and creates:

   ```sql
   CREATE TABLE IF NOT EXISTS chunks_<slug> (
     id            TEXT PRIMARY KEY,
     source_type   TEXT NOT NULL,
     source_id     TEXT NOT NULL,
     chunk_index   INTEGER NOT NULL,
     display_text  TEXT NOT NULL,
     text_preview  TEXT,
     metadata_json TEXT,
     model         TEXT NOT NULL,
     embedded_at   TIMESTAMP NOT NULL,
     text_sha      TEXT NOT NULL,
     vector        vector(<dim>) NOT NULL
   );
   ```

   It also creates a `(source_type, source_id)` btree index. The binding builds
   partial HNSW indexes for canonical source types such as `code-chunk`,
   `chat-log-chunk`, and `document-chunk`.

8. Upsert writes chunks.

   `__embed_store_upsert(handle, rowJson)` parses a `ChunkRow`, sanitizes UTF-8
   text fields, serializes the vector as a pgvector literal, and runs
   `INSERT ... ON CONFLICT(id) DO UPDATE`.

9. Search returns dense top-N.

   `__embed_store_search_json(handle, qvecJson, n, sourceType)` runs:

   ```sql
   SELECT ..., 1.0 - (vector <=> '<qvec>'::vector) AS score
   FROM chunks_<slug>
   WHERE source_type = '<sourceType>' -- only when provided
   ORDER BY vector <=> '<qvec>'::vector
   LIMIT <n>;
   ```

   The JS result is an array of `SearchHit` objects with `dense_score`.

10. Optional rerank scores dense candidates.

   `embed.rerank(rerankerPath, query, candidates)` lazy-loads one
   `embed.Reranker` for the path, formats a yes/no relevance prompt, decodes one
   forward pass, reads logits for the `yes` and `no` tokens, and returns:

   ```text
   exp(yes) / (exp(yes) + exp(no))
   ```

   `useEmbed.query` uses rerank only when `reranker` is configured and
   `topn > k`; it fetches dense `topn`, reranks those candidates, sorts by
   `rerank_score`, and returns top `k`.

11. Ingest uses a multi-worker pool.

   `useEmbed.startIngest(rootPath, nWorkers, kind)` calls:

   ```ts
   __embed_ingest_start(rootPath, kind, modelPath, slug, nWorkers)
   ```

   The binding:

   - refuses to start if another ingest is still running
   - ensures the shared model is loaded
   - frees the query context for the duration of ingest
   - opens the store for the selected slug and dimension
   - maps `kind` to a `SourceKind`
   - starts `embed.IngestSession`

   Each ingest worker owns a `WorkerCtx` created from the shared model. The
   model weights are shared; each worker has its own llama context, KV/cache
   state, tokenizer/decode loop, and store writes. Progress is exposed through
   atomics plus a small mutex-protected current-file snapshot.

## Source Kinds

`embed.SourceKind` maps ingest kinds to canonical `source_type` labels:

```text
code             -> code-chunk
claude           -> chat-log-chunk
claude-overflow  -> chat-log-chunk
codex            -> chat-log-chunk
kimi             -> chat-log-chunk
memory           -> document-chunk
```

The walkers cover repository files, Claude JSONL logs, Claude overflow logs,
Codex session JSONL, Kimi context JSONL, and `memory/*.md` files.

## Important Constraints

- Local chat is subprocess-based today. Older comments in `useLocalChat`,
  `llm_lab`, `cart/app/app.md`, and dependency-registry notes still mention
  `libllama_ffi`, LM Studio backend dlopen, or in-process chat. The current
  code path is `framework/local_ai_runtime.zig` -> `rjit-llm-worker` ->
  `deps/llama.cpp-fresh` shared libraries.
- `framework/local_ai_runtime_old.zig` is not the active path.
- `useLocalChat` has one global native session per cart process and one
  in-flight `ask()` per hook.
- `useEmbed` has one global shared model, query context, reranker, store, and
  ingest session per cart process. The TS handles are not independent native
  handles yet.
- `__localai_send` does not expose per-call `max_tokens` or `system_prompt`.
- Chat model paths are absolute or `cwd`-relative. `~` expansion is not
  implemented in `resolveModelPathAlloc`.
- `__localai_set_tools` updates are flushed immediately before the next `CHAT`.
  A schema change while a generation is already running applies on the next
  turn.
- `scripts/ship` bundles the local chat worker whenever the SDK gate is on, not
  only when `useLocalChat` specifically triggered SDK.
- Rebuild `rjit-llm-worker` explicitly after changing
  `framework/ffi/llm_worker.cpp` or the upstream llama.cpp build:

  ```sh
  ./scripts/build-llm-worker.sh
  ```

## Related Files

- `runtime/hooks/useLocalChat.ts`
- `framework/v8_bindings_sdk.zig`
- `framework/local_ai_runtime.zig`
- `framework/ffi/llm_worker.cpp`
- `framework/ffi/llama_headers/`
- `scripts/build-llm-worker.sh`
- `runtime/hooks/embed.ts`
- `runtime/hooks/useEmbed.ts`
- `framework/v8_bindings_embed.zig`
- `framework/embed.zig`
- `framework/pg.zig`
- `scripts/ship`
- `sdk/dependency-registry.json`
- `cart/app/isolated_tests/llm_lab/index.tsx`
- `cart/app/isolated_tests/browse-agent.tsx`
- `cart/app/isolated_tests/embed_lab/index.tsx`
- `cart/gguf_finder.tsx`
