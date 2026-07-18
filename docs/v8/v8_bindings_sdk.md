# V8 Host SDK Bindings

Last updated: 2026-04-28.

This document maps the JS-host bridge used by the V8 runtime and the first three files it directly depends on in the same direction.

## 1) `framework/v8_bindings_sdk.zig` (entry point)

Purpose
- Registers host functions used by cart/JS runtime as `globalThis` functions (via `v8rt.registerHostFn`).
- Pumps async networking and browser-page results back into JS through `__ffiEmit`.
- Normalizes backend event payloads from Claude/Kimi/local-ai into stable JS objects.

Global state
- `g_http_pending`: map `id -> { rid, stream }` for async HTTP requests.
- `g_page_pending`: map `id -> rid` for async page fetch requests.
- Per-transport session handles:
  - `g_claude_session: ?claude_sdk.Session`
  - `g_kimi_session: ?kimi_wire_sdk.Session`
  - `g_local_ai_session: ?*local_ai_runtime.Session`
- Kimi turn text buffers: `g_kimi_turn_text`, `g_kimi_turn_thinking`.

Host registration surface (`registerSdk`)
- Network: `__fetch`, `__http_request_sync`, `__http_request_async`, `__http_stream_open`, `__http_stream_close`, `__browser_page_sync`, `__browser_page_async`.
- Player: `__play_*`, `__rec_*`.
- AI: `__claude_*`, `__kimi_*`, `__localai_*`.
- IPC debug: `__ipc_*`.
- Semantic tree: `__sem_*`.

### Network flow (important)
- Sync path:
  - `hostHttpRequestSync` parses JSON request payload and forwards to `httpSyncViaCurl`; returns JSON string (`status`, `headers`, `body`, optional `error`).
- Async path:
  - `dispatchHttpRequest` (used by `hostHttpRequestAsync` and `hostHttpStreamOpen`) parses JSON, stores rid in `g_http_pending`, sets `net_http.RequestOpts`, calls `net_http.request`.
  - `tickDrain` polls `net_http.poll` and emits:
    - non-stream: `http:<rid>` + full JSON payload
    - stream chunk: `http-stream:<rid>` + chunk body string
    - stream end/error: `http-stream-end:<rid>` + `{"status":N}` or `{"error":"..."}`
- Browser page fetch:
  - `hostBrowserPageSync` calls `net_http.fetchSync`
  - `hostBrowserPageAsync` queues request in `net_http` and stores rid
  - `tickDrain` polls `net_http.poll` and emits `browser-page:<rid>`.

### AI bridges
- Claude/Kimi/local-ai each have `init/send/poll/close` hosts.
- Conversion helpers normalize SDK messages:
  - `claudeMessageToJs`
  - `kimiMessageToJs`
  - `localAiEventToJs`
- Kimi collects turn-level text (`assistant`, `thinking`) and emits in final `response` object when present.

### IPC/debug bridge
- Thin wrappers around `debug_client`:
  - connect/disconnect/poll/status/perf/request/request-node/submit code + tree node access.
- `hostIpcResponse` returns last serialized response string directly.

### Semantic bridge
- Exposes semantic state, cache, rows, node metadata, tree snapshots, and ticking.
- `hostSemSnapshot` returns full structured object with
  - top-level mode/classifier/frame,
  - `state`,
  - `rows` cache dump with text + color,
  - `graph` (node/turn counts and serialized tree).

## 2) `framework/v8_runtime.zig` (dependency hop 1)

Purpose
- Owns V8 VM/process lifecycle and JS global function bridging API used by the SDK module.

Key concepts
- VM state:
  - `g_platform`, `g_isolate`, `g_context`, top-level `HandleScope`.
- Lifecycle APIs:
  - `initVM()` creates platform + isolate + context and applies stack limit workaround.
  - `resetContextForReload()` rebuilds context and clears `input.zig` state for hot-reload.
  - `teardownVM()` / `deinit` cleanup stack, isolate, platform, buffers.
- Host function registration:
  - `registerHostFn(name, callback)` installs callback on current context global object via v8 `FunctionTemplate`.
- Script execution:
  - `evalScript`, `evalScriptChecked`, `evalToString`, `hasGlobal`.
  - Exceptions are captured with local `TryCatch` and logged.
- Native->JS callback helpers:
  - `callGlobal`, `callGlobalStr`, `callGlobal2Str`, plus numeric overloads and `dispatchEffectRender`.

Notable behavior for SDK users
- `callGlobalWithArgs` forces explicit microtask checkpoint after function call:
  - avoids deferred promise continuation starvation/ordering issues.
- `evalScriptChecked` returns bool to gate hot-reload rollback on script compile/run failures.
- Exception path logs to `~/.cache/reactjit/v8-errors.jsonl` in addition to stderr.

## 3) `framework/net/http.zig` (dependency hop 2)

Purpose
- Async HTTP(S) client backed by libcurl worker threads with fixed-capacity ring buffers.

Topology
- Request/response types:
  - `RequestOpts`, `Request`, `Response`, `Method`, `ResponseType`.
- Limits are fixed at compile-time:
  - max workers: `4`
  - max headers: `16`
  - max request body: `16KB`
  - max response body copy per response/chunk: `64KB`
  - queue depth: `16`

Flow
- `init()` spawns worker threads and initializes curl.
- `request(id, opts)` copies request fields into fixed arrays and pushes into ring request queue.
- `workerMain` pops requests:
  - streaming requests (`stream=true`) emit chunk responses directly from libcurl callback.
  - non-stream requests aggregate into single `Response` and push to response queue.
- `poll(out)` drains completed responses; SDK reads this in `tickDrain`.
- `destroy()` pushes shutdown sentinels then joins all threads and `curl_global_cleanup`.

Execution internals
- `executeRequest` sets libcurl method/headers/body/proxy/timeouts.
- Callback in `executeRequest`:
  - if accumulating response: fills `Response.body` and marks `truncated`.
  - if streaming: emits `.chunk` responses by slicing into `MAX_BODY` chunks.
- Supports `GET/POST/PUT/DELETE/PATCH/HEAD`, proxy from opts or environment, and follows redirects in curl options.

## 4) Browser page fetch (unified into `framework/net/http.zig`)

Purpose
- Browser-like GET-only page fetch for shell-like HTML/text extraction.
- Unified with the generic HTTP client — shares the same `std.http.Client` worker pool.

Topology
- Uses the same `Request`/`Response` types as generic HTTP, with additional fields:
  - `final_url` — captured from the redirect chain
  - `content_type` — captured from the `Content-Type` header
- Constants: queue depth `16`, workers `4`.

Flow
- `init()` starts worker threads (shared with all HTTP traffic).
- Async queue:
  - `request(id, .{ .url = url })` copies URL bytes, pushes request.
  - `poll(out)` returns completed `Response` values.
- Sync path:
  - `fetchSync(.{ .url = url })` runs `executeRequest` inline and returns `Response` directly.
- Shutdown via `destroy()` pushes sentinel `Request` records and joins workers.

Execution internals
- `executeRequest` uses `std.http.Client`'s low-level API to capture headers and final URL after redirects.
  - performs redirect loop using `resolveRedirect`, bounded by `MAX_REDIRECTS` and a simple status whitelist.
  - parses HTTP status, `content-type`, `location`, chunked transfer.
  - copies final URL/content-type/body into fixed response buffers.
- `fetchOnce` manually builds HTTP/1.1 request and performs:
  - plain TCP via `std.net.tcpConnectToHost` for `http`
  - TLS client stream via `tls` for `https`.
- `readAllBytes` captures raw response with truncation handling.
- `parseHttpResponse` handles raw parsing and chunked decoding in `decodeChunkedBody`.

Cross-file call summary
- SDK dispatches browser/HTTP work into these modules.
- `v8_bindings_sdk.tickDrain()` is the per-frame bridge: reads async queues from both modules and emits JS events.
- `v8_runtime` provides function registration and event callback dispatch (`__ffiEmit`) used by the SDK emitter path.

## framework/assistant/claude_sdk/session.zig

- `Session` is the core process bridge to the `claude` CLI. It stores the
  injected `std.Io`, an active `std.process.Child`, a `ChildStdout` owner, and
  the NDJSON `ReadBuffer`.
- `SessionOptions` configures:
  - `path` (optional binary path override)
  - `instruction` text
  - `cwd` override
  - `allowedTools` / `disallowedTools`
  - `maxTurns` and `model`
  - `permissionMode` and `permissionPromptToolName`
- `init(io, environ_map, allocator, options)`:
  - resolves executable: uses explicit `options.path` or default `PATH` lookup for `claude`
  - builds argv and calls `std.process.spawn(io, ...)` with stdin/stdout pipes
  - transfers stdout ownership to `ChildStdout`, whose cancelable
    `std.Io.Group` reader task publishes bytes through a fixed-capacity
    `std.Io.Queue`
  - initializes the `ReadBuffer` used by frame-facing polling; it does not set
    descriptor flags or poll raw fd readiness.
- `send(prompt)`:
  - writes a JSON envelope using NDJSON framing:
    - `{"type":"user","message":...}`
    - message content is escaped using `appendJsonString`
  - appends newline terminator and writes it with
    `std.Io.File.writeStreamingAll(io, ...)`.
- `interrupt()`:
  - writes an interrupt JSON envelope (`{"type":"interrupt"}\n`) through the
    injected I/O capability.
- `poll() : ?types.OwnedMessage`:
  - drains currently available complete lines via `line_buffer` first.
  - when no buffered line remains, drains bytes already available in
    `ChildStdout`'s bounded queue into an internal chunk and appends them to
    `ReadBuffer`.
  - repeatedly parses complete lines and returns the first valid message; returns `null` when no message is currently ready.
  - treats the reader task's EOF/failure state as process closure and closes
    stdin.
- `close()` and `deinit()`:
  - `close()` closes stdin and synchronously waits for process completion.
  - `deinit()` is idempotent cleanup: closes stdin, kills child if running, then destroys line buffer and marks closed.
- Parsing/error behavior:
  - `parseLine` uses an arena allocator to isolate parse allocations and dispatches to `parser.parseMessage`.
  - invalid JSON/log lines are caught, logged with `std.log.warn`, and ignored by returning `null`.
- Test coverage in-file checks happy path for JSON parsing and that `Session` can initialize/shutdown in constrained scenarios.

## framework/assistant/claude_sdk/parser.zig

- Implements `parseMessage` for NDJSON event lines emitted by the Claude child process and converts them into strongly-typed `types.Message` unions.
- Public entrypoint:
  - `parseMessage(arena, line) !?types.Message`
  - trims whitespace
  - returns `null` for empty lines
  - maps JSON parse errors to `error.InvalidJson` and schema mismatches to `error.MissingField`.
- Event dispatch by `type` field:
  - `system` → `types.Message.system`
  - `assistant` → `types.Message.assistant`
  - `user` → `types.Message.user`
  - `result` → `types.Message.result`
  - any unknown type is silently dropped as `null`.
- `parseSystem`:
  - extracts `session_id` (required), optional `model`, `cwd`, and optional `tools` array.
  - emits `types.SystemMsg` with owned tool-string slice.
- `parseAssistant`:
  - parses nested `message` object
  - reads optional `id`, `session_id`, `stop_reason`
  - extracts `usage` counters (`input_tokens`, `output_tokens`, cache counters)
  - parses content through `parseContentBlocks`
  - emits `types.AssistantMsg`.
- `parseUser`:
  - extracts optional `session_id`
  - stores raw JSON string of `message.content` (or `"null"` fallback) into `content_json`.
- `parseResult`:
  - extracts required `session_id` and optional `result`, `total_cost_usd`, timing counters.
  - classifies `subtype` as `error_result` when `is_error` true or `subtype == "error"`; otherwise `success`.
  - emits `types.ResultMsg`.
- `parseContentBlocks`:
  - handles array payload only; unknown block types are skipped.
  - parses `text`, `thinking`, and `tool_use` blocks into `types.ContentBlock` entries.
  - `tool_use.input` is stringified JSON via `stringifyAlloc` with safe `"{}"` fallback.
- Utility getters (`getString`, `getObject`, `getArray`, `getInt`, `getFloat`, `getBool`) perform lightweight `std.json.Value` type checks.
- Ownership model:
  - all returned strings/slices are arena-allocated, matching session/poller expectations.

## framework/assistant/claude_sdk/types.zig

- Defines the message schema used across Claude SDK runtime:
  - `TextBlock`, `ThinkingBlock`, `ToolUseBlock` are simple payload structs.
  - `ContentBlock` is a tagged union over `text | thinking | tool_use`.
- `Usage` accumulates token counters:
  - `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.
- Event payload structs:
  - `SystemMsg`: required `session_id`, optional `model`, `cwd`, and `tools` list.
  - `AssistantMsg`: optional `id`, optional `session_id`, `content` block array, optional `stop_reason`, and `Usage`.
  - `UserMsg`: optional `session_id`, raw `content_json` string.
  - `ResultMsg`: `subtype` (`success | error_result`), required `session_id`, optional `result`, plus cost/duration/turn metadata and `is_error`.
- Aggregate enums:
  - `Message` union of `system`, `assistant`, `user`, `result`.
- Ownership boundary:
  - `OwnedMessage` wraps `msg` and an `ArenaAllocator`.
  - `deinit()` on `OwnedMessage` is required to free arena-backed strings/arrays allocated during parse.

## framework/assistant/claude_sdk/options.zig

- Defines runtime configuration for `claude` subprocess sessions.
- `PermissionMode` enum maps programmatic modes to CLI strings:
  - `default`
  - `accept_edits`
  - `plan`
  - `bypass_permissions`
  - `toCli()` emits `default`, `acceptEdits`, `plan`, `bypassPermissions`.
- `SessionOptions` fields:
  - `cwd` (required): absolute working directory for the child process
  - `cli_path`: optional override for binary path (defaults PATH lookup)
  - `model`: optional model override
  - `system_prompt`: optional system prompt injection
  - `allowed_tools`: allow-list; empty means no explicit allow filtering
  - `disallowed_tools`: explicit deny-list
  - `permission_mode`: defaults to `.bypass_permissions`
  - `max_turns`: optional max turns per send
  - `resume_session`: optional previous `session_id` resume token
  - `continue_conversation`: whether to continue latest convo in `cwd`
  - `verbose`: defaults true (needed for stream-json when stdin is not a TTY)
  - `add_dirs`: extra `--add-dir` paths passed to CLI
  - `inherit_stderr`: optional forwarding of subprocess stderr for debug/auth failures
- This module is consumed by `mod.zig` re-exports and `session.zig` launch/argument construction.

## framework/assistant/claude_sdk/buffer.zig

- Implements an in-memory NDJSON accumulator for stream-safe reading from `claude` stdout.
- `ReadBuffer` fields:
  - `buffer`: mutable append-only staging bytes
  - `last_line`: stable storage for the last drained line
  - `allocator`: allocation source
- API:
  - `init(allocator)` → zeroed `ReadBuffer`
  - `deinit()` releases `buffer` memory (currently `last_line` is intentionally not explicitly deinitialized in this impl)
  - `append(data)` appends byte chunks drained from `ChildStdout`'s bounded queue
  - `drain()` returns next full line (without trailing `\n`) or `null` if no complete line exists
- Line handling:
  - Finds first newline index
  - Empty lines (`\n`) are skipped recursively
  - Copies line slice into `last_line` for stable lifetime until next mutation
  - Removes consumed bytes with `consume(n)` (front-compaction) so partial tail data remains for next read
- Internal helper `consume(n)` shifts buffer contents left and shrinks capacity safely when n >= len.
- Tests cover empty input, partial writes, multiple lines, and empty-line skipping.

## framework/assistant/claude_sdk/argv.zig

- Provides subprocess argument construction and binary lookup for `Session` startup.
- `findBinary(allocator, cli_path)`:
  - returns `cli_path` clone if provided
  - otherwise scans `PATH` using path delimiter and looks for executable `claude`
  - uses `std.fs.accessAbsolute` for existence probe
  - returns `error.BinaryNotFound` if not discoverable.
- `buildSessionArgv(allocator, binary, opts)`:
  - always starts with executable path plus `--input-format stream-json --output-format stream-json`.
  - conditionally appends flags from `SessionOptions`:
    - `--verbose` when enabled
    - `--model <model>`
    - `--system-prompt <value>`
    - `--allowedTools <comma_joined_list>`
    - `--disallowedTools <comma_joined_list>`
    - permission mode:
      - `.bypass_permissions` => `--dangerously-skip-permissions`
      - others => `--permission-mode <cli string>` via `toCli()`
    - `--max-turns <n>`
    - `--resume <session_id>` or `--continue`
    - per-dir `--add-dir <dir>` entries
  - all strings are individually allocated via caller allocator; returned slice owns argv text.
- `freeArgv` deallocates each argument and the outer slice.
- Construction is written to match stream-json constraints and current agent-facing CLI behavior; MCP-related flags are intentionally deferred.

## framework/assistant/claude_sdk/mod.zig

- Module entrypoint for the Claude Code Agent SDK.
- Re-exports:
  - `options`, `types`
  - `Session` struct
  - type aliases: `PermissionMode`, `SessionOptions`, `Message`, `OwnedMessage`, `ContentBlock`, `TextBlock`, `ThinkingBlock`, `ToolUseBlock`, `Usage`, `SystemMsg`, `AssistantMsg`, `UserMsg`, `ResultMsg`, `ResultSubtype`
- Acts as a stable public façade so users import one module and get all SDK types.
- Includes an import-only test block to force compile-time resolution of all internal modules:
  - `buffer.zig`, `types.zig`, `options.zig`, `parser.zig`, `argv.zig`, `session.zig`
- README-style doc comments describe lifecycle model:
  - one long-lived child process per `Session`
  - `send()` writes NDJSON turns
  - `poll()` non-blocking drain each GUI frame.

## framework/worker_contract.zig

- Normalizes all agent backends (Claude, Codex app server, Kimi wire) into one append-only worker/session event model.
- Core enums:
  - `Backend`: `.claude_code`, `.codex_app_server`, `.kimi_cli_wire`
  - `WorkerStatus`: `idle | active | streaming | switching | completed | error_`
  - `SessionStatus`: `starting | active | ended | error_`
  - `EventKind`: lifecycle/context/status/user/assistant/reasoning/tool_call/tool_output/usage/completion/error_/raw
  - `MessageRole`: `system | user | assistant | tool | internal`
- Data models:
  - `UsageTotals` with additive `.add()`.
  - `WorkerSnapshot` (UI-facing aggregated state)
  - `TranscriptEntry` (lightweight immutable transcript row)
  - `SessionEpisode` (per backend conversational run)
  - `WorkerEvent` (owned event rows, includes payload text/json, model, phase, cost/usage deltas).
- `WorkerStore` is the mutable store per worker:
  - owns worker metadata, status, current session/model pointers, session/event arrays
  - lifecycle APIs:
    - `init/deinit`
    - `snapshot()`
    - `activeSession()/activeSessionMut()`
    - `beginSession/switchSession/endActiveSession`
    - `recordUserMessage`, session-binding helpers (`bindClaudeMetadata`, `bindCodexThread`, `bindKimiSession`)
  - ingestion:
    - `ingestClaudeMessage(claude_types.Message)` expands system/assistant/user/result messages into events and usage/cost updates.
    - `ingestCodexNotification(*codex_sdk.Notification)` maps notification methods and item payloads into normalized events.
    - `ingestKimiWireMessage(*kimi_wire_sdk.InboundMessage)` maps event/request/response kinds into events.
  - readback:
    - `recentTranscript(limit)` returns owned `TranscriptEntry` copies.
- Internal helpers:
  - `ensureActiveSession`, `appendEvent`, `appendKimiEvent`, `setCurrentModel`, session id/thread/model update helpers
  - `normalizeCodexItem`, usage extractors, role/kind conversion, JSON path and string helpers
  - safe allocation pattern via `dupOpt`, with explicit `deinit` on owned events/episodes
- `appendEvent` allocates all event-owned strings for the store; event ids are monotonic `next_event_id`.
- Includes parser helper functions for Codex/Kimi JSON (`getPath`, `getStringPath`, `intFromPath`, etc.) and JSON string escaping for tool metadata.
- Tests validate cross-backend ingestion and transcript/snapshot coherence for Claude, Codex, and Kimi paths.

## framework/agent_session.zig

- Declares a generic, provider-agnostic agent execution loop:
  - user message → streaming model round(s) → optional tool calls → tool execution → loop until no tool calls or max rounds.
- Public primitives:
  - `MessageRole` and `ToolCall` (`id`, `name`, `arguments`)
  - `Message` (`role`, `content`, optional `tool_calls`, optional `tool_call_id`, allocator-owned, with `deinit()`)
  - `StreamDelta` for incremental streaming chunk updates
  - `HTTPRequest` abstraction (`url`, `method`, `headers`, `body`)
- Provider abstraction (`Provider`): vtable for
  - `formatRequest(messages, tools)`
  - `parseStreamChunk(chunk, delta)`
  - `deinit()`.
- `SessionConfig` includes provider, model, system prompt, tools, work dir, tool-round cap, temperature/max_tokens.
- `AgentSession` stateful struct:
  - tracks `messages`, active streaming buffer, pending tool calls, tool execution records, callback hooks, and cleanup lifecycle.
- Flow:
  - `create(allocator, config)` initializes lists and optionally seeds system prompt.
  - `sendMessage(content)` appends user message and enters `runAgentLoop()`.
  - `runAgentLoop()` runs up to `max_tool_rounds`:
    - `streamRound()` obtains request from provider, parses streaming chunks into assistant message; current implementation placeholder for actual HTTP streaming.
    - append assistant message to history.
    - if no tool calls, return to idle.
    - else execute tools via `executeTools`, append each result message, continue loop.
  - `executeTools()` executes each tool with `ToolExecutor`, tracks `ToolExecution` lifecycle (`pending/running/completed/error_`), invokes callbacks.
  - `destroy()` performs allocator-backed deinit for messages, pending calls, executions, and provider.
- Callback registration API for host bindings:
  - `setOnStreamChunk`, `setOnToolStart`, `setOnToolEnd`, `setOnError`.
- Exposed C FFI exports at file end:
  - `agent_session_create`, `agent_session_destroy`, `agent_session_send_message`, `agent_session_get_state`, `agent_session_set_on_stream_chunk`.
- Note: this file is currently scaffolding in places (streaming request transport TODO placeholder), but the orchestration and callback structure is complete.

## framework/agent_spawner.zig

- Implements forked subagent workflow modeled after `forkSubagent.ts`.
- Maintains thread-local agent context (`current_context`) with helpers:
  - `getAgentContext`, `setAgentContext`, `clearAgentContext`, `runWithAgentContext`.
- `AgentContext` fields include IDs/types (`main/subagent/teammate`), parent linkage, invocation kind (`spawn|resume`), and telemetry flag.
- `ForkConfig` controls:
  - `directive`, inherit flags (`context`, `system_prompt`)
  - model/provider/work-dir overrides
  - tool list inheritance
  - `max_turns`, isolated worktree and permission mode (`inherit|bubble|isolated`)
- `ForkedAgent` state:
  - identity (`agent_id`, `parent_session_id`)
  - lifecycle status (`spawning|running|paused|completed|error_`)
  - optional in-process `session` or `child_process`
  - copied `messages` and final report/exit code
  - callbacks for message/complete/error delivery
- `create(allocator, parent_session, config)`:
  - generates `agent_<ms>` id
  - clones parent message history when `inherits_context`
  - note: tool-call deep copy is intentionally deferred (TODO marker in code)
- `start()` sets `.running`, installs context, builds forked message list via `buildForkedMessages`, and currently logs/placeholder execution.
- `buildForkedMessages()`:
  - if no context, returns single user message with fork directive.
  - otherwise keeps conversation up to last assistant message, injects synthetic tool-result messages for prior tool calls, appends one user message with directive.
  - message cloning intentionally omits deep copy of `tool_calls` (explicit TODO comment).
- `buildChildMessage()` returns a large static directive template to force strict execution semantics for forked agents (no meta, tool-first, concise report, prefixed sections).
- `destroy()` frees message history, final report, and nested session if present.
- Current execution path is scaffolded (session/process run details are TODO-style placeholders), but context-cloning/message-shaping and lifecycle/callback structure are already present.

## framework/tool_framework.zig

- Core tool abstraction + execution orchestration layer used by agent sessions and core orchestration.
- Public schemas and types:
  - `ToolInputSchema` (minimal JSON schema-like metadata)
  - `ToolResult` (`content`, `is_error`) with `deinit()`
  - `ProgressUpdate` (`pending|running|progress|completed|error_`, optional message/percent)
  - `ToolContext` (allocator, work_dir, tool_use_id, progress/error callbacks, abort check)
  - `ToolExecuteFn`, `ToolValidateFn`
  - `Tool` with execution/validate/policy callbacks (`isConcurrencySafe`, read-only/destructive/shell-state)
- `ToolRegistry`:
  - holds `StringHashMap(Tool)`
  - init/register/get/unregister/list
- `ToolExecutor` concurrency model:
  - maintains queue of `QueuedTool` (`queued|executing|completed|yielded`) with task, result, context
  - `queue()` stores deep-copied inputs, assigns `tool_use_id`, creates `ToolContext` with internal abort checker, signals and calls `processQueue()`.
  - `canExecute()` enforces exclusivity: unsafe tools block concurrent execution; safe tools can run in parallel only when no unsafe runner active.
  - `processQueue()` walks queue FIFO and starts runnable tools.
  - `executeTool()` runs the tool in the executor's injected-I/O `std.Io.Group`, updates progress/completion, invokes `on_complete`, and propagates bash failures to sibling-abort (`has_errored` + `should_abort`).
  - `getResult(tool_use_id)` returns copied `ToolResult` if available.
  - `waitAll()`, `cancelAll()`, `reset()` manage lifecycle.
- Built-in tool:
  - `BuiltInTools.bashTool()` with execute + classification helpers.
  - Bash execute uses PTY (`PTY.openPty`) with timeout loop, accumulates output, returns exit status-derived `.is_error`.
  - Concurrency safety heuristics parse shell command (sequential for `&&`, `;`, `cd`, `export`).
  - destructive/shell-state classifiers detect patterns (e.g., `rm`, redirections, `mv`, `cp`, `dd`, `cd`, `export`).
- Exposed C exports for registry/executor creation, queue, wait, reset, and destroy.
- Note: there are TODO comments in schema completeness and synchronous path remains minimal (`execute` returns output content only).

## framework/process/process.zig

- Tracks children on Zig 0.16's native `std.process` and injected `std.Io`, with
  normal and piped spawn helpers plus deterministic registry cleanup.
- `spawn(allocator, io, std.process.SpawnOptions)` calls
  `std.process.spawn(io, options)`. A cancelable `std.Io.Group` waiter task owns
  `child.wait(io)` and publishes the native `Child.Term` through atomic state and
  an `std.Io.Event`.
- `Process` methods:
  - `alive()` reads the state published by that waiter task; it does not call
    `waitpid(WNOHANG)`.
  - `termination()`/`exitCode()` expose the cached native terminal state.
  - `sendSignal(.term|.kill_)` is the narrow POSIX boundary used to signal
    without stealing wait/reap ownership from the native task.
  - `closeProcess(io)` performs graceful terminate, waits on the completion
    event, joins the task group, and deregisters the child.
- `spawnPiped` transfers native stdin/stdout/stderr `std.Io.File` values out of
  the spawned child. Each output file gets a cancelable reader task and a fixed
  128 KiB `std.Io.Queue`; frame-facing drain methods only consume queued bytes.
- Registry infrastructure:
  - fixed-size PID list (`MAX_CHILDREN = 32`) with path `/tmp/tsz_children_<PARENT_PID>`.
  - `register`/`deregister` keep array updated and persist `writeRegistryFile()`.
  - `killAll()` sends SIGTERM to all then SIGKILL after short wait, reaps, resets count, and calls `cleanup()`.
  - `cleanup()` removes PID registry file.
  - helper getters: `count()`, `getPid(index)`.
- Exposed primarily to tool/bash execution and subprocess orchestration paths.
- `PipedProcess.deinit(io)` closes stdin, closes the tracked process, cancels the
  file pumps, and closes their native files. No descriptor flags or raw
  readiness loop are involved.

## framework/agent_core.zig

- Top-level façade module for agent runtime in `framework/`.
- Re-exports core types from:
  - `agent_session`: `AgentSession`, `SessionConfig`, `SessionState`, `Message`, `ToolCall`, `Provider`, `StreamDelta`
  - `tool_framework`: `Tool`, `ToolResult`, `ToolContext`, `ProgressUpdate`, `ToolRegistry`, `ToolExecutor`
  - `agent_spawner`: `ForkedAgent`, `ForkConfig`, `AgentPool`, `AgentContext`, `AgentType`
  - `tools_builtin` as `tools_builtin` namespace.
- Global singleton state:
  - `g_tool_registry : ?ToolRegistry`
  - `g_agent_pool : ?AgentPool`
  - `g_allocator = c_allocator`
- `init()` lazily initializes registry and pool, registering built-ins (`bash`, file and search/task tools).
- `deinit()` tears down both registry and pool.
- `getToolRegistry()/getAgentPool()` enforce singleton initialization.
- `ProviderConfig` + `ProviderType` (`anthropic`, `openai`, `custom`) with `createProvider()` placeholder that currently returns `error.NotImplemented`.
- C/Javascript bridge exports:
  - session lifecycle: `agent_core_create_session`, `agent_core_destroy_session`, `agent_core_session_send`
  - callback wiring scaffold: `agent_core_session_set_callbacks`
  - subagent lifecycle: `agent_core_fork_agent`, `agent_core_agent_send`, `agent_core_agent_terminate`, `agent_core_agent_set_callbacks`
  - sync tool execution: `agent_core_execute_tool_sync`
- Bridge type layer includes opaque handles and callback typedefs.
- `agent_core_execute_tool_sync` creates temporary `ToolExecutor`, executes one tool sync, returns heap-copied result pointer + error flag.
- Several callback wrappers are partial/scaffolded (`_ = on_tool_start`, similar), indicating incomplete JS/Lua binding completeness in this file.

## framework/tools_builtin.zig

- Implements concrete `Tool` providers used by the agent runtime.
- Imports `tool_framework` types plus `PTY`, `Process`, and logging.
- Bash tool:
  - `BashInput` schema includes `command`, optional `timeout_ms`, `cwd`, `env`.
  - `bashTool()` wires execute + classification hooks.
  - `bashExecute`:
    - parses command/input JSON
    - opens PTY with configurable cwd, writes env `export`s when provided
    - streams output in timed loop, reports progress (`running/progress/completed`), supports abort check
    - enforces timeout and returns error result if exceeded
    - truncates very large output to bounded tail and reports with truncation notice
    - marks `is_error` by PTY exit code.
  - classifiers:
    - `bashIsConcurrencySafe` excludes chained commands and shell-state mutators (`cd`, `export`, `source`, leading `.`)
    - `bashIsReadOnly` recognizes benign read commands
    - `bashIsDestructive` flags destructive patterns (`rm`, `mv`, `dd`, redirection)
    - `bashModifiesShellState` identifies shell state mutations.
- Read/file tools:
  - `readFileTool()` parses `file_path`, optional `offset`, `limit`, resolves relative path using `work_dir`, returns numbered lines.
- Write/file-edit tools:
  - `writeFileTool()` writes (overwrite/create) and ensures parent directory exists; marked exclusive + destructive.
  - `fileEditTool()` performs exact replace of `old_string -> new_string`, writes back updated content.
- Search tools:
  - `globTool()` currently shells out via `find ... | head`; returns summary string.
  - `grepTool()` builds an `rg` command array, spawns `rg`, and returns summary.
  - both are classified as concurrency-safe/read-only for planning.
- Task tools:
  - `TaskRegistry` tracks background tasks in `StringHashMap` with mutex and incremental id.
    - `TaskInfo`: id, command, description, status, exit_code, output_path, optional Process handle.
    - `init/createTask/getTask/stopTask` operations.
  - `taskCreateTool()` creates background task and returns id/output file summary.
- C exports export each tool constructor (`tools_builtin_get_*`) for host interop.
- Most tool executors are implemented for orchestration but some output behavior is high-level summary rather than full command output integration in places (`globExecute`, `grepExecute`).

## framework/agent_spawner.zig (continued details)

- Additional `ForkedAgent` methods:
  - `sendMessage(content)` — requires status `.running` or `.paused`; appends user message, marks context as `resume`.
  - `pause()`, `resume()` switch status state machine.
  - `terminate()` marks `.completed`, and if `child_process` exists sends SIGTERM and closes process.
  - callback setters remain as handles for message/complete/error.
- `AgentPool` manages multiple `ForkedAgent` instances by string id:
  - owns `StringHashMap(*ForkedAgent)` with mutex.
  - `init/deinit` (destruction terminates all entries).
  - `spawn(parent_session, config)` creates child agent, registers in map, starts it.
  - `get(agent_id)` lookup by id.
  - `terminateAll()` and `list(out)` iteration helpers.
- C exports at bottom:
  - pool lifecycle: `agent_pool_create`, `agent_pool_destroy`
  - `agent_pool_spawn`
  - `forked_agent_send_message`, `forked_agent_terminate`, `forked_agent_get_status`
- This confirms full subagent orchestration path: `agent_core` calls into `AgentPool`, and `ForkedAgent` handles message enqueue/resume and termination semantics.

## framework/terminal/pty.zig

- Implements pseudo-terminal lifecycle and shell-backed interactive execution.
- Direct libc is confined to PTY/session setup and control:
  `posix_openpt`, `grantpt`, `unlockpt`, `ptsname_r`, child `fork`/`setsid`/
  `dup2`/`execvp`, and `ioctl` for controlling-terminal/window-size operations.
- `openPty(allocator, io, opts)` wraps the parent master as `std.Io.File` and
  starts cancelable reader, writer, and child-wait tasks in an `std.Io.Group`.
  Fixed-capacity `std.Io.Queue` instances carry output bytes and pending writes.
- Core runtime methods:
  - `readData()` drains bytes already published by the reader task without
    waiting on a descriptor.
  - `writeData()` copies and queues a write for the injected-Io writer task.
  - `resize(rows, cols)` is the PTY-specific `TIOCSWINSZ` ioctl boundary.
  - `alive()`/`exitCode()` read state published by the `child.wait(io)` task.
  - `closePty()` closes queues, cancels the task group, terminates/reaps through
    `std.Io`, and closes the native master file.
- Steady-state I/O does not use `O_NONBLOCK`, raw `read`/`write`, or an fd
  readiness loop.
- This module is primarily used by `tool_framework.bash` and `tools_builtin.bash` for interactive shell semantics.
