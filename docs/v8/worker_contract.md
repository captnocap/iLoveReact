# V8 Worker Contract Pipeline

Last updated: 2026-05-04

This document traces the worker contract pipeline end to end.

In this repository "worker contract" means the normalized model for agent-like
runtime actors: one durable worker identity, one or more backend session
episodes, and an append-only stream of events that UI surfaces can render
without knowing the provider wire shape.

There are two overlapping contracts today:

- the canonical Zig contract in `framework/worker_contract.zig`
- the cart/gallery contract around compact JS events such as `assistant_part`,
  `tool_call`, `status`, and `result`

The Zig contract is broader and backend-agnostic. The V8 SDK bridge currently
exposes provider-specific poll events directly; it does not yet expose
`WorkerStore` or normalized `WorkerEvent` rows as a host API.

## Source Map

| Layer | Files | Role |
| --- | --- | --- |
| Canonical worker model | `framework/worker_contract.zig` | Owns `WorkerStore`, sessions, normalized events, snapshots, transcript readback, and provider normalizers. |
| Claude wire SDK | `framework/claude_sdk/session.zig`, `framework/claude_sdk/types.zig` | Spawns `claude`, sends stream-json user turns, polls NDJSON output into typed messages. |
| Codex app-server SDK | `framework/codex_sdk.zig` | Speaks JSON-RPC over `codex app-server --listen stdio://`; produces app-server notifications. |
| Kimi wire SDK | `framework/kimi_wire_sdk.zig` | Speaks Kimi `--wire` JSON-RPC over stdio; produces event/request/response messages. |
| Local AI runtime | `framework/local_ai_runtime.zig`, `framework/ffi/llm_worker.cpp` | Spawns `rjit-llm-worker`, emits local chat events over an in-process event ring. |
| V8 worker binding | `framework/worker_bindings.zig` (called from `framework/v8_bindings_sdk.zig` `registerSdk`) | Registers `__worker_start`, `__worker_send`, `__worker_poll`, `__worker_respond`, `__worker_set_tools`, `__worker_close`; recognizes `claude_code`, `kimi_cli_wire`, and `local_ai` backends and normalizes their events. |
| Legacy QJS provider globals | `framework/qjs_runtime.zig` | Registers `__claude_*`, `__kimi_*`, `__localai_*` directly on the QuickJS runtime only. Not registered on V8. |
| React hooks | `runtime/hooks/useAssistant.ts` | V8 cart entry point — drives `__worker_start` / `__worker_send` / `__worker_poll`, exposes phase, streaming text, tool calls, and event kinds for any registered backend. |
| Gallery data shapes | `cart/app/gallery/data/worker.ts`, `worker-session.ts`, `worker-event.ts`, `event-adapter.ts` | Documents UI/database-facing worker/session/event shapes and adapter rules. |
| Older cockpit consumer | `cart/deadcode/cockpit/index.tsx` | Historical reducer that consumes compact JS event variants per backend. |
| Adjacent docs | `docs/v8/claude-sdk.md`, `docs/v8/codex-sdk.md`, `docs/v8/llamacpp.md`, `docs/v8/v8_bindings_sdk.md` | Backend-specific and binding-specific context. |

## Executive Flow

Canonical native flow:

1. A caller creates a `WorkerStore` with `WorkerStore.init`.
2. The store keeps durable worker metadata: id, display name, objective, role,
   timestamps, aggregate usage, cost, and current status.
3. A backend session is attached with one of:

```zig
beginSession(...)
bindClaudeMetadata(...)
bindCodexThread(...)
bindKimiSession(...)
```

4. Provider wire events arrive from Claude, Codex, or Kimi SDKs.
5. The caller feeds those events into:

```zig
ingestClaudeMessage(...)
ingestCodexNotification(...)
ingestKimiWireMessage(...)
```

6. The ingest function maps provider-specific fields into a normalized
   `WorkerEvent`.
7. `appendEvent` copies all owned strings into the store, assigns a monotonic
   event id, updates `last_active_at_ms`, and increments the active session's
   event count.
8. `snapshot()` returns aggregate UI state.
9. `recentTranscript(limit)` returns owned transcript rows for display.

Current V8 cart flow:

1. `scripts/ship` enables `-Dhas-sdk=true` when SDK hooks/features are used.
2. `v8_app.zig` imports `framework/v8_bindings_sdk.zig`.
3. Startup calls `registerSdk`.
4. `registerSdk` registers host globals such as:

```text
__claude_init
__claude_send
__claude_poll
__claude_close
__kimi_init
__kimi_send
__kimi_poll
__kimi_close
__localai_init
__localai_send
__localai_poll
__localai_close
```

5. Cart hooks poll provider-specific JS event objects.
6. Cart reducers or hooks accumulate those objects into UI-local transcript
   state.

The provider-specific path above still exists, but it is no longer the only
surface. `framework/v8_bindings_sdk.zig` now also calls
`framework/worker_bindings.zig` (`worker_bindings.register()` at the tail of
`registerSdk`), which exposes `worker_contract.WorkerStore` directly to JS via
`__worker_start` / `__worker_send` / `__worker_poll` / `__worker_respond` /
`__worker_set_tools` / `__worker_close`. Carts on the new path receive
already-normalized `WorkerEvent` rows; carts on the legacy provider globals
still bypass `worker_contract.zig`.

## Build And Registration

`build.zig` exposes:

```text
-Dhas-sdk=true
```

The option is described as registering HTTP, Claude, Kimi, local AI, browser,
IPC, media, and semantic-tree bindings.

`v8_app.zig` gates the module:

```zig
const v8_bindings_sdk =
    if (build_options.has_sdk)
        @import("framework/v8_bindings_sdk.zig")
    else
        stub;
```

The ingredient table includes:

```zig
.{ .name = "sdk", .required = false, .grep_prefix = "__http_request_", .reg_fn = "registerSdk", .mod = v8_bindings_sdk },
```

The SDK binding is broad: worker-adjacent host functions ride the same SDK gate
as HTTP, browser-page, media, IPC, and semantic-tree functions.

`registerSdk` registers the worker-adjacent globals unconditionally once the SDK
binding is enabled:

```text
__claude_init
__claude_send
__claude_poll
__claude_close
__kimi_init
__kimi_send
__kimi_poll
__kimi_close
__localai_init
__localai_send
__localai_poll
__localai_close
__localai_set_tools
__localai_send_tool_result
```

There is no `__worker_*` host API today.

## Canonical Data Model

`framework/worker_contract.zig` defines the backend enum:

```zig
pub const Backend = enum {
    claude_code,
    codex_app_server,
    kimi_cli_wire,
};
```

The worker status enum:

```zig
pub const WorkerStatus = enum {
    idle,
    active,
    streaming,
    switching,
    completed,
    error_,
};
```

The session status enum:

```zig
pub const SessionStatus = enum {
    starting,
    active,
    ended,
    error_,
};
```

The normalized event kind enum:

```zig
pub const EventKind = enum {
    lifecycle,
    context_switch,
    status,
    user_message,
    assistant_message,
    reasoning,
    tool_call,
    tool_output,
    usage,
    completion,
    error_,
    raw,
};
```

The role enum:

```zig
pub const MessageRole = enum {
    system,
    user,
    assistant,
    tool,
    internal,
};
```

These enums are the closed canonical vocabulary for provider-normalized worker
events. Provider-specific names belong in `phase`, `status_text`, or
`payload_json`, not in new top-level event kinds.

## Usage Totals

`UsageTotals` carries aggregate token counters:

```zig
input_tokens
output_tokens
cache_creation_input_tokens
cache_read_input_tokens
```

`UsageTotals.add` accumulates one delta into another. The store keeps totals at
two levels:

- `WorkerStore.usage`
- `SessionEpisode.usage`

Provider usage frames are normalized into a `WorkerEvent` with kind `usage` and
the same delta in `usage_delta`.

## WorkerStore

`WorkerStore` is the mutable owner for one UI worker:

```zig
allocator
worker_id
display_name
objective
assigned_role
status
current_backend
current_model
created_at_ms
last_active_at_ms
switch_count
total_cost_usd
usage
next_session_seq
next_event_id
active_session_index
sessions
events
```

The store owns all string memory it stores. Public ingest methods accept borrowed
provider data, then `appendEvent` duplicates fields into store-owned memory.

`deinit` frees:

- worker metadata strings
- current model string
- every `SessionEpisode`
- every `WorkerEvent`
- the session and event arrays

## Store API Surface

Lifecycle and readback:

```zig
WorkerStore.init(allocator, StoreConfig) !WorkerStore
WorkerStore.deinit() void
WorkerStore.snapshot() WorkerSnapshot
WorkerStore.activeSession() ?*const SessionEpisode
WorkerStore.activeSessionMut() ?*SessionEpisode
WorkerStore.recentTranscript(allocator, limit) ![]TranscriptEntry
```

Session lifecycle:

```zig
WorkerStore.beginSession(StartSessionOptions) !*SessionEpisode
WorkerStore.switchSession(StartSessionOptions) !*SessionEpisode
WorkerStore.endActiveSession(SessionStatus, reason) !void
```

Message/session helpers:

```zig
WorkerStore.recordUserMessage(text, turn_id) !void
WorkerStore.bindClaudeMetadata(session_id, model) !void
WorkerStore.bindCodexThread(thread_id, model, reason_started) !void
WorkerStore.bindKimiSession(external_session_id, model, reason_started) !void
```

Provider ingestion:

```zig
WorkerStore.ingestClaudeMessage(claude_types.Message) !void
WorkerStore.ingestCodexNotification(*const codex_sdk.Notification) !void
WorkerStore.ingestKimiWireMessage(*const kimi_wire_sdk.InboundMessage) !void
```

Internal write path:

```zig
ensureActiveSession(backend) !*SessionEpisode
appendEvent(EventSpec) !void
appendKimiEvent(...)
setCurrentModel(...)
updateSessionModel(...)
updateSessionExternalId(...)
updateSessionThreadId(...)
```

## StoreConfig

`StoreConfig` is the construction surface:

```zig
worker_id: []const u8
display_name: ?[]const u8 = null
objective: ?[]const u8 = null
assigned_role: ?[]const u8 = null
```

`worker_id` is required and is duplicated into store-owned memory.

## StartSessionOptions

`StartSessionOptions` creates or switches a backend session:

```zig
backend: Backend
model: ?[]const u8 = null
reason_started: ?[]const u8 = null
external_session_id: ?[]const u8 = null
thread_id: ?[]const u8 = null
```

Use `external_session_id` for provider-owned session ids such as Claude or Kimi.
Use `thread_id` for Codex app-server threads.

## SessionEpisode

`SessionEpisode` is one backend attachment under a durable worker:

```zig
id
worker_id
backend
model
external_session_id
thread_id
status
reason_started
reason_ended
started_at_ms
ended_at_ms
switch_index
turn_count
total_cost_usd
usage
event_count
```

`beginSession` creates ids as:

```text
<worker_id>:session:<next_session_seq>
```

Starting a new session while another is active marks the old session as ended,
sets `reason_ended` to `"superseded"` when unset, and increments
`switch_count`.

`switchSession` calls `beginSession`, appends a `context_switch` event, then
sets worker status to `switching`.

`endActiveSession` clears the active pointer and maps session status back to
worker status:

| Session status | Worker status |
| --- | --- |
| `ended` | `completed` |
| `error_` | `error_` |
| anything else | `idle` |

It also appends either `completion` or `error_`.

## WorkerEvent

`WorkerEvent` is the owned append-only row:

```zig
id: u64
worker_id: []const u8
session_id: []const u8
backend: Backend
kind: EventKind
role: ?MessageRole
model: ?[]const u8
phase: ?[]const u8
text: ?[]const u8
payload_json: ?[]const u8
turn_id: ?[]const u8
thread_id: ?[]const u8
external_session_id: ?[]const u8
status_text: ?[]const u8
cost_usd_delta: f64
usage_delta: UsageTotals
created_at_ms: i64
```

Field intent:

| Field | Meaning |
| --- | --- |
| `id` | Store-local monotonic event id. |
| `worker_id` | Durable worker identity. |
| `session_id` | Store session episode id. |
| `backend` | Normalized backend enum. |
| `kind` | Closed canonical event kind. |
| `role` | Message speaker/tool/internal role. |
| `model` | Model active when event was appended. |
| `phase` | Provider or UI phase, for example `thinking`, `delta`, `turn_started`. |
| `text` | Display text or concise event text. |
| `payload_json` | Full provider payload when preserving raw detail matters. |
| `turn_id` | Provider turn id when available. |
| `thread_id` | Codex thread id when available. |
| `external_session_id` | Provider session id when available. |
| `status_text` | Provider status/type/method string. |
| `cost_usd_delta` | Cost delta or terminal total, depending on provider. |
| `usage_delta` | Token usage delta for this event. |
| `created_at_ms` | Host timestamp from `realMillis(io)`, backed by `std.Io.Clock`'s real-time clock. |

`appendEvent` duplicates every optional string. It does not deduplicate repeated
model/session/status strings across events.

## WorkerSnapshot

`snapshot()` returns:

```zig
worker_id
display_name
objective
assigned_role
status
current_backend
current_model
created_at_ms
last_active_at_ms
switch_count
total_cost_usd
usage
active_session_id
session_count
event_count
```

Snapshot strings are borrowed from the store. They are valid only while the
store remains alive and unchanged in ways that free the underlying field.

## TranscriptEntry

`recentTranscript(allocator, limit)` returns owned lightweight rows:

```zig
event_id
session_id
backend
kind
role
model
phase
text
turn_id
thread_id
created_at_ms
```

It starts at `max(0, event_count - limit)` and copies rows in original event
order. Callers own the returned slice and the duplicated optional strings.

`worker_contract.zig` has an internal `freeTranscriptEntries` helper used by
tests, but it is not public API.

## Claude Normalization

Input type:

```zig
claude_types.Message
```

The Claude SDK path is:

```text
claude subprocess
  -> stream-json NDJSON
  -> framework/claude_sdk/session.zig poll()
  -> claude_types.OwnedMessage
  -> WorkerStore.ingestClaudeMessage
```

`ingestClaudeMessage` mapping:

| Claude message | Normalized events | Store/session updates |
| --- | --- | --- |
| `system` | `lifecycle`, role `system`, text `claude session metadata`, payload JSON array of tool names, status `system` | Ensures Claude session, updates model and external session id. |
| `assistant` usage | `usage`, role `internal`, status `assistant_usage` | Adds usage to session and worker, sets worker status `streaming`. |
| `assistant` text block | `assistant_message`, role `assistant`, phase `final`, text block content | Keeps backend/model/session ids. |
| `assistant` thinking block | `reasoning`, role `assistant`, phase `thinking`, text thinking content | Keeps backend/model/session ids. |
| `assistant` tool_use block | `tool_call`, role `tool`, phase `tool_use`, text tool name, payload JSON with id/name/input_json | Keeps backend/model/session ids. |
| `user` | `user_message`, role `user`, text extracted from content JSON when possible, full payload in `payload_json` | Updates external session id when present. |
| `result` success | `completion`, role `internal`, phase result subtype, text result, status `success` | Updates turn count, session total cost, worker total cost, worker status `active`. |
| `result` error | `error_`, role `internal`, phase result subtype, text result, status `error` | Updates turn count/cost, worker status `error_`. |

Claude tool lists are serialized manually to a JSON string array. Claude user
text extraction is best-effort: it parses `content_json`, accepts a string
`content`, or the first array entry with a `text` field.

## Codex Normalization

Input type:

```zig
*const codex_sdk.Notification
```

The Codex SDK path is:

```text
codex app-server --listen stdio://
  -> JSON-RPC notifications
  -> framework/codex_sdk.zig Notification
  -> WorkerStore.bindCodexThread
  -> WorkerStore.ingestCodexNotification
```

Thread binding:

```zig
bindCodexThread(thread_id, model, reason_started)
```

If no active Codex session exists, it begins one with backend
`codex_app_server`. If the active session is already Codex, it updates the
model and thread id.

Notification mapping:

| Codex method | Normalized event | Notes |
| --- | --- | --- |
| `turn/started` | `lifecycle`, role `internal`, phase `turn_started`, status `turn_started` | Increments `turn_count`, sets worker status `streaming`. |
| `item/agentMessage/delta` | `assistant_message`, role `assistant`, phase `delta` | Text comes from `params.delta`. |
| `reasoning/textDelta` | `reasoning`, role `assistant`, phase `reasoning` | Text comes from `params.delta`. |
| `reasoning/summaryTextDelta` | `reasoning`, role `assistant`, phase `reasoning` | Same field extraction. |
| `item/completed` | depends on completed item | Full notification payload is preserved in `payload_json`. |
| `thread/tokenUsageUpdated` | `usage`, role `internal`, status `token_usage` | Adds token usage to session and worker. |
| `turn/completed` | `completion` or `error_`, role `internal`, phase `turn_completed` | Error if `turn.error.message` exists. |
| `item/commandExecution/outputDelta` | `tool_output`, role `tool` | Raw payload only today. |
| `item/fileChange/outputDelta` | `tool_output`, role `tool` | Raw payload only today. |
| `mcpToolCall/progress` | `tool_output`, role `tool` | Raw payload only today. |
| unknown method | `raw`, role `internal` | `status_text` stores the method. |

Completed item mapping:

| `item.type` | Normalized event |
| --- | --- |
| `agentMessage` with phase containing `reason` | `reasoning`, role `assistant`, phase copied, text copied |
| `agentMessage` otherwise | `assistant_message`, role `assistant`, phase copied, text copied |
| `message` role `user` | `user_message`, role `user`, text joined from content blocks |
| `message` role `assistant` | `assistant_message`, role `assistant`, text joined from content blocks |
| `message` role `system` | `lifecycle`, role `system`, text joined from content blocks |
| `message` role `tool` | `tool_output`, role `tool`, text joined from content blocks |
| `commandExecution` | `tool_output`, role `tool` |
| `fileChange` | `tool_output`, role `tool` |
| `mcpToolCall` | `tool_output`, role `tool` |
| unknown item type | `raw` |

Codex message text join accepts content array blocks whose `type` is:

```text
output_text
input_text
text
```

Usage extraction expects:

```text
tokenUsage.inputTokens
tokenUsage.outputTokens
tokenUsage.cacheCreationInputTokens
tokenUsage.cacheReadInputTokens
```

The Codex contract preserves unknown methods and unknown item types as `raw`,
which is the correct extension path while the app-server protocol changes.

## Kimi Normalization

Input type:

```zig
*const kimi_wire_sdk.InboundMessage
```

The Kimi SDK path is:

```text
kimi --wire
  -> JSON-RPC event/request/response lines
  -> framework/kimi_wire_sdk.zig InboundMessage
  -> WorkerStore.bindKimiSession
  -> WorkerStore.ingestKimiWireMessage
```

Session binding:

```zig
bindKimiSession(external_session_id, model, reason_started)
```

If no active Kimi session exists, it begins one with backend `kimi_cli_wire`.
If the active session is already Kimi, it updates model and external session id.

Event mapping:

| Kimi event type | Normalized event | Notes |
| --- | --- | --- |
| `TurnBegin` | `user_message`, role `user`, phase `turn_begin` | Increments turn count, extracts `user_input`, status `TurnBegin`. |
| `SteerInput` | `user_message`, role `user`, phase `steer` | Extracts `user_input`. |
| `TurnEnd` | `completion`, role `internal`, phase `turn_end` | Worker status `active`. |
| `StatusUpdate` with usage | `usage`, role `internal`, phase `status_update` | Adds usage to session and worker. |
| `StatusUpdate` without usage | `status`, role `internal`, phase `status_update` | Raw payload preserved. |
| `ContentPart` type `text` | `assistant_message`, role `assistant`, phase `text` | Text from `payload.text`; worker status `streaming`. |
| `ContentPart` type `think` | `reasoning`, role `assistant`, phase `think` | Text from `payload.think`; worker status `streaming`. |
| `ToolCall` | `tool_call`, role `tool`, phase `tool_call` | Text is `function.name`. |
| `ToolCallPart` | `tool_call`, role `tool`, phase `tool_call_delta` | Text is `arguments_part`. |
| `ToolResult` | `tool_output`, role `tool`, phase `tool_result` | Text extracted from result; status becomes `error` when return value says so. |
| `PlanDisplay` | `assistant_message`, role `assistant`, phase `plan` | Text from `content`. |
| `BtwBegin` | `status`, role `internal`, phase `btw_begin` | Text from `question`. |
| `BtwEnd` with error | `error_`, role `internal`, phase `btw_end` | Text from `error`. |
| `BtwEnd` with response | `assistant_message`, role `assistant`, phase `btw_end` | Text from `response`. |
| `StepBegin`, `StepInterrupted`, `CompactionBegin`, `CompactionEnd`, `ApprovalResponse`, `HookTriggered`, `HookResolved` | `status`, role `internal` | Phase is event type. |
| unknown event | `raw`, role `internal` | Status is event type. |

Request mapping:

| Kimi request type | Normalized event |
| --- | --- |
| `ToolCallRequest` | `tool_call`, role `tool`, phase `tool_request`, text payload name |
| `ApprovalRequest` | `status`, role `internal`, phase `approval_request`, text description or action |
| `QuestionRequest` | `status`, role `internal`, phase `question_request`, text first question |
| `HookRequest` | `status`, role `internal`, phase `hook_request`, text target |
| unknown request | `raw`, role `internal` |

Response mapping:

| Kimi response | Normalized event |
| --- | --- |
| `error.message` present | `error_`, role `internal`, phase `rpc_response`, text error message |
| status `finished` | `completion`, role `internal`, phase `rpc_response` |
| status `cancelled` | `completion`, role `internal`, phase `rpc_response` |
| status `max_steps_reached` | `completion`, role `internal`, phase `rpc_response` |
| other status | `status`, role `internal`, phase `rpc_response` |
| no status | `raw`, role `internal`, phase `rpc_response` |

Kimi usage fields are named differently from Codex:

```text
token_usage.input_other
token_usage.output
token_usage.input_cache_creation
token_usage.input_cache_read
```

The normalizer maps them back into `UsageTotals`.

## Local AI Events

`worker_bindings.register()` recognizes `local_ai` as a live backend alongside
`claude_code` and `kimi_cli_wire`. `LocalAiSession` (`worker_bindings.zig`
~L315) wraps `local_ai_runtime.Session`, owns an inbox of `OwnedEvent` rows,
and plumbs `enqueue` (send), `drainInbox` (poll), `submitToolReply`
(respond), and `setTools` through the standard `__worker_*` hosts. So
`__worker_start("local_ai", optsJson)` returns a real worker id and the V8
event flow is:

```text
framework/local_ai_runtime.zig
  -> OwnedEvent
  -> framework/worker_bindings.zig LocalAiSession.drainInbox
  -> __worker_poll(workerId)
  -> runtime/hooks/useAssistant.ts
```

The legacy `framework/v8_bindings_sdk.zig localAiEventToJs` /
`runtime/hooks/useLocalChat.ts` flow described in older versions of this doc
applied only to QuickJS — those `__localai_*` globals are not registered on
V8, and `useLocalChat.ts` is no longer present in `runtime/hooks/`.

Local event kinds:

```zig
system
assistant_part
status
result
tool_call
```

`localAiEventToJs` intentionally emits JS objects keyed by `kind`, not `type`:

```text
{ kind: "system", model?, session_id? }
{ kind: "assistant_part", part_type, text? }
{ kind: "status", text?, is_error }
{ kind: "result", text?, is_error }
{ kind: "tool_call", id?, name?, args? }
```

`useLocalChat` consumes `kind` and accumulates:

- `phase`
- `error`
- `lastStatus`
- `pulse`
- `streaming`
- `toolCalls`

It also handles tool calls by executing registered JS tool handlers and replying
through:

```text
__localai_send_tool_result(id, body)
```

If local AI should become part of the canonical native worker contract, add a
fourth backend enum or decide whether local AI maps to an existing backend
category. Then add an `ingestLocalAiEvent` method that maps local `OwnedEvent`
to `system`, `assistant_message`, `status`, `completion`, and `tool_call`.

## V8 Provider Event Bridge

The active V8 bridge exposes one global session per provider:

```zig
var g_claude_session: ?claude_sdk.Session = null;
var g_kimi_session: ?kimi_wire_sdk.Session = null;
var g_local_ai_session: ?*local_ai_runtime.Session = null;
```

That means each provider binding is process-global, not worker-id scoped. A
second cart or UI pane calling the same provider globals can share or steal the
same backend session unless the caller coordinates access.

### Claude Host API

Registered globals:

```text
__claude_init(cwd, model?, resumeSession?, configDir?) -> bool
__claude_send(text) -> bool
__claude_poll() -> object | undefined
__claude_close() -> undefined
```

`hostClaudeInit` builds `claude_sdk.SessionOptions`:

```zig
cwd
model
resume_session
config_dir
verbose = true
permission_mode = .bypass_permissions
inherit_stderr = true
```

`hostClaudePoll` calls `Session.poll()`, deinitializes the owned message after
conversion, and returns a provider-shaped JS object from `claudeMessageToJs`.

Claude JS event shapes:

```text
{ type: "system", session_id, model, cwd, tools }
{ type: "assistant", content, text?, thinking?, stop_reason?, ... }
{ type: "user", session_id?, content_json }
{ type: "result", subtype, session_id, result?, total_cost_usd, duration_ms, num_turns, is_error }
```

### Kimi Host API

Registered globals:

```text
__kimi_init(cwd, model?, sessionId?) -> bool
__kimi_send(text) -> bool
__kimi_poll() -> object | undefined
__kimi_close() -> undefined
```

`hostKimiInit` builds `kimi_wire_sdk.SessionOptions`:

```zig
cwd
model
session_id
yolo = true
inherit_stderr = true
```

It also calls `initialize` immediately before storing the session globally.

`hostKimiPoll` converts each `InboundMessage` through `kimiMessageToJs`.

Kimi JS event shapes include:

```text
{ type: "turn_begin", text? }
{ type: "usage", input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
{ type: "assistant_part", part_type, text? }
{ type: "tool_call", name?, input_json? }
{ type: "tool_result", text?, is_error }
{ type: "status", status?, text?, is_error? }
{ type: "result", result?, is_error? }
```

The Kimi bridge also has turn-local buffers for assistant text and thinking.
Those buffers are bridge implementation details, not part of the canonical
worker contract.

### Local AI Host API

Registered globals:

```text
__localai_init(cwd, modelPath, sessionId?, nCtx?) -> bool
__localai_send(text) -> bool
__localai_poll() -> object | undefined
__localai_close() -> undefined
__localai_set_tools(json) -> bool
__localai_send_tool_result(id, body) -> bool
```

`local_ai_runtime.Session` owns a worker thread and child `rjit-llm-worker`
process. It communicates with the child over a small line protocol documented in
`docs/v8/llamacpp.md`.

Unlike Claude and Kimi, local AI's hook consumes `kind`, not `type`.

## React Hook Layer

`runtime/hooks/useClaudeChat.ts` wraps the Claude host globals.

Public hook shape:

```ts
{
  phase,
  error,
  lastStatus,
  pulse,
  streaming,
  ask,
  isAvailable,
  ready,
}
```

Phases:

```text
init
loading
loaded
generating
idle
failed
```

The hook:

1. Calls `__claude_init` on mount.
2. Polls `__claude_poll` on an interval.
3. Treats init success as loaded because Claude does not emit `system` until a
   user turn arrives.
4. Sends prompts through `__claude_send`.
5. Accumulates assistant `text` into `streaming`.
6. Resolves the active `ask()` promise on `result`.
7. Drops `user` echo messages.

`runtime/hooks/useLocalChat.ts` wraps local AI and exposes the same broad shape
plus tool handling:

```ts
{
  phase,
  error,
  lastStatus,
  pulse,
  streaming,
  ask,
  isAvailable,
  ready,
  toolCalls,
  clearToolCalls,
}
```

There is no current `useKimiChat.ts` equivalent in `runtime/hooks/`; older
cockpit code drives `__kimi_*` directly.

## Gallery Data Shapes

The gallery files document the intended database/UI surface. They are not the
same as `framework/worker_contract.zig`, but they point in the same direction.

### `worker.ts`

`Worker` is the runtime actor row:

```ts
id
userId
workspaceId
projectId?
environmentId?
settingsId
sessionId?
label
kind
lifecycle
roleId?
connectionId
modelId
parentWorkerId?
childWorkerIds?
maxConcurrentRequests
spawnedAt
lastActivityAt?
terminatedAt?
```

The gallery lifecycle vocabulary is richer and more UI-oriented than
`WorkerStatus`:

```text
spawning
active
idle
streaming
suspended
terminating
terminated
crashed
```

The native status vocabulary is:

```text
idle
active
streaming
switching
completed
error_
```

A production persistence layer will need an explicit mapping between these two.

### `worker-session.ts`

`WorkerSession` is a compact UI row:

```ts
id
provider: "claude" | "kimi" | "local"
model
status: "complete" | "running" | "failed"
startedAt
endedAt?
eventCount
```

Native `SessionEpisode` is more detailed:

- backend enum distinguishes `claude_code`, `codex_app_server`, and
  `kimi_cli_wire`
- session has both `external_session_id` and `thread_id`
- status vocabulary is `starting | active | ended | error_`
- usage, total cost, switch index, and reason fields are native-only today

### `worker-event.ts`

The gallery `WorkerEvent` union is compact and frontend-oriented:

```ts
system
assistant
assistant_part
turn_begin
tool_call
tool_result
status
result
```

Native `EventKind` is different:

```text
lifecycle
context_switch
status
user_message
assistant_message
reasoning
tool_call
tool_output
usage
completion
error_
raw
```

Suggested conceptual mapping:

| Gallery event | Native event |
| --- | --- |
| `system` | `lifecycle` |
| `assistant` | `assistant_message` plus possible `reasoning` and `tool_call` split-outs |
| `assistant_part` text | `assistant_message` with phase `delta` or provider phase |
| `assistant_part` thinking | `reasoning` |
| `turn_begin` | `lifecycle` or `user_message` depending provider |
| `tool_call` | `tool_call` |
| `tool_result` | `tool_output` |
| `status` | `status` or `error_` |
| `result` | `completion` or `error_` |

Native is better for storage and cross-provider query. Gallery is better for
small reducer examples and compact story fixtures.

### `event-adapter.ts`

`event-adapter.ts` describes adapter rules as data:

```ts
rawSelector
normalizedType
fieldMap
notes
```

It currently documents:

- Claude Code CLI NDJSON -> compact `WorkerEvent`
- OpenAI-compatible SSE Codex chunks -> compact `WorkerEvent`

This is gallery design context. Native Codex uses app-server JSON-RPC
notifications, not the OpenAI-compatible SSE chunk shape from
`codex-raw-event.ts`.

## Older Cockpit Reducers

`cart/deadcode/cockpit/index.tsx` contains the historical reducer layer:

```ts
reduceClaudeEvent(worker, evt)
reduceKimiEvent(worker, evt)
reduceLocalEvent(worker, evt)
```

These reducers consume the V8 provider JS objects, not native `WorkerEvent`
rows.

Claude reducer:

- `system` clears content and updates session/model ids.
- `assistant` walks mixed content blocks:
  - text appends assistant content
  - thinking appends thinking content
  - tool_use appends a tool line
- `result` finishes the turn, records cost, and handles errors.

Kimi reducer:

- `turn_begin` clears content.
- `assistant_part` appends thinking or assistant text.
- `tool_call` appends a tool line.
- `tool_result` appends a result line.
- `status` appends system/error status.
- `result` finishes the turn.

Local reducer mirrors Kimi's compact event style.

This code is useful because it shows the UI semantics the normalized contract is
meant to support: streaming text, reasoning, tools, results, costs, active
model/session ids, and turn completion.

## Raw Payload Policy

The native contract keeps two levels of data:

- normalized query/display fields
- raw JSON payload preservation

Use normalized fields for common UI:

```text
kind
role
phase
text
model
turn_id
usage_delta
cost_usd_delta
```

Use `payload_json` when:

- a provider method is not recognized yet
- the event contains structured details not represented in common fields
- debugging needs the original app-server/wire payload
- future code may need to re-normalize old events

Unknown provider events should become `raw`, not be dropped.

## Ordering And Ownership

Events are append-only in store order. The store does not reorder by provider
turn id or provider timestamp.

`appendEvent` assigns:

```zig
id = next_event_id
created_at_ms = realMillis(self.io)
```

Then increments `next_event_id`.

The worker store owns event memory. Provider-owned arenas can be deinitialized
after ingestion.

`recentTranscript` returns a separate owned copy. Free the returned entries when
done.

## Status Semantics

The store updates `WorkerStatus` in several places:

| Action | Worker status |
| --- | --- |
| `beginSession` | `active` |
| `switchSession` | `switching` |
| `recordUserMessage` | `active` |
| Claude assistant message | `streaming` |
| Claude result success | `active` |
| Claude result error | `error_` |
| Codex `turn/started` | `streaming` |
| Codex assistant delta | `streaming` |
| Codex turn completed success | `active` |
| Codex turn completed error | `error_` |
| Kimi `TurnBegin` / `SteerInput` | `active` |
| Kimi `ContentPart` | `streaming` |
| Kimi response error | `error_` |
| `endActiveSession(.ended)` | `completed` |
| `endActiveSession(.error_)` | `error_` |

The current normalizer generally treats a completed turn as the worker remaining
active, not globally completed. `completed` is reserved for explicitly ending
the active session.

## Costs And Usage

Claude:

- assistant usage becomes a `usage` event and adds to usage totals
- result `total_cost_usd` is assigned to session total cost
- worker total cost becomes the max of current worker cost and result total
- the event's `cost_usd_delta` is set to `total_cost_usd`, although that field
  name implies a delta

Codex:

- `thread/tokenUsageUpdated` becomes a `usage` event and adds to usage totals
- cost is not computed

Kimi:

- `StatusUpdate` with token usage becomes a `usage` event and adds to usage
  totals
- cost is not computed

Local AI:

- local events do not carry usage/cost in the current hook path
- local events do not enter `WorkerStore`

## Current Gaps

`framework/worker_contract.zig` is now wired into `framework/v8_bindings_sdk.zig`
via `framework/worker_bindings.zig` (`worker_bindings.register()` is called from
`registerSdk`). It exposes `__worker_start`, `__worker_send`, `__worker_poll`,
`__worker_respond`, `__worker_set_tools`, and `__worker_close`, each
worker-scoped by id.

Remaining gaps:

- `claude_code`, `kimi_cli_wire`, and `local_ai` are live backends.
  `__worker_start("codex_app_server", …)` returns `""` until its V8 bridge
  lands.
- legacy provider globals (`__claude_*`, `__kimi_*`, `__localai_*`) are
  registered only on the QuickJS runtime (`framework/qjs_runtime.zig`); on V8
  there is no parallel surface to migrate away from, only the new
  `__worker_*` path.
- there is no `__worker_snapshot` yet — readback is poll-only
- gallery data shapes and native structs have different enum names and field
  names

A UI that wants a true multi-worker surface should migrate carts onto the
`__worker_*` host fns; JS-side normalization remains only for backends not yet
covered by `worker_bindings`.

## Suggested V8 Worker API

A direct binding should avoid exposing provider globals as the primary surface.
The cart should talk in worker/session terms:

```text
__worker_create(config_json) -> worker_id
__worker_begin_session(worker_id, options_json) -> session_id
__worker_send(worker_id, text) -> bool
__worker_poll(worker_id) -> WorkerEvent | undefined
__worker_snapshot(worker_id) -> WorkerSnapshot
__worker_recent_transcript(worker_id, limit) -> TranscriptEntry[]
__worker_close(worker_id) -> void
```

Provider-specific controls can be options:

```json
{
  "backend": "claude_code",
  "cwd": "/path/to/project",
  "model": "claude-opus-4-7",
  "resumeSession": "...",
  "configDir": "..."
}
```

or:

```json
{
  "backend": "codex_app_server",
  "cwd": "/path/to/project",
  "model": "gpt-5.4",
  "approvalPolicy": "never"
}
```

The binding should decide whether `poll` returns:

- raw `WorkerEvent` rows
- compact gallery-style events
- both, with native rows as the durable layer and compact events as a view

For storage and debugging, native rows should be the durable layer.

## Extension Checklist

When adding a provider to the canonical worker contract:

1. Add or reuse a `Backend` enum value.
2. Keep `EventKind` closed unless the new provider exposes a truly new
   cross-provider concept.
3. Preserve provider-specific method/type strings in `phase` or `status_text`.
4. Preserve full structured provider payloads in `payload_json`.
5. Add a `bind<Provider>Session` helper when the provider has its own thread or
   session id.
6. Add `ingest<Provider>...` that accepts the provider SDK type.
7. Normalize usage into `UsageTotals`.
8. Add tests covering:
   - session binding
   - assistant text
   - reasoning
   - tool calls/output
   - usage
   - completion
   - unknown/raw event preservation
9. Update gallery adapters or data-shape docs only if the UI-facing compact
   contract changes.
10. If exposing to V8, make the API worker-scoped instead of adding another
    single global provider session.

## Tests

`framework/worker_contract.zig` includes native tests for:

- Claude session metadata and transcript
- Codex notifications in one session timeline
- session switching preserving worker identity and incrementing switch count
- Kimi wire events in one session timeline

Those tests exercise the normalizer directly. They do not verify V8 host
bindings, React hooks, gallery schemas, or UI reducers.

## Review Notes

- `WorkerStore` is canonical for native normalization, but not yet the live V8
  cart API.
- `WorkerEvent.cost_usd_delta` is used as a terminal total for Claude result
  events; the name is sharper than the current behavior.
- `appendEvent` copies strings aggressively. This is simple and safe, but can
  duplicate model/session/status strings heavily in long sessions.
- `snapshot()` returns borrowed strings, while `recentTranscript()` returns owned
  copies. Keep that distinction clear in any binding.
- Codex native normalization targets app-server JSON-RPC. Gallery Codex adapter
  targets OpenAI-compatible SSE chunks. They are different pipelines.
- Local AI is worker-like in UI, but absent from `framework/worker_contract.zig`.
- Provider globals in `v8_bindings_sdk.zig` are singletons. They do not model
  multiple simultaneous workers safely.
- Unknown methods/items become `raw`, which is the right default for changing
  provider protocols.

## Related Files

- `framework/worker_contract.zig`
- `framework/claude_sdk/session.zig`
- `framework/claude_sdk/types.zig`
- `framework/codex_sdk.zig`
- `framework/kimi_wire_sdk.zig`
- `framework/local_ai_runtime.zig`
- `framework/v8_bindings_sdk.zig`
- `runtime/hooks/useClaudeChat.ts`
- `runtime/hooks/useLocalChat.ts`
- `cart/app/gallery/data/worker.ts`
- `cart/app/gallery/data/worker-session.ts`
- `cart/app/gallery/data/worker-event.ts`
- `cart/app/gallery/data/event-adapter.ts`
- `cart/deadcode/cockpit/index.tsx`
