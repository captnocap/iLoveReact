# V8 Kimi SDK Pipeline

Last updated: 2026-05-04.

This document traces the Kimi Code CLI bridge end to end: how a cart gets the
`__kimi_*` globals, how those globals spawn and drive `kimi --wire`, how wire
messages come back into JavaScript, and how the same typed messages can be
normalized by the worker contract.

## Mental Model

Kimi support is not an HTTP Moonshot API client. It is a process bridge around
the Kimi Code CLI wire protocol:

```text
cart JS
  -> globalThis.__kimi_init/send/poll/close
  -> framework/v8_bindings_sdk.zig
  -> framework/kimi_wire_sdk.zig Session
  -> child process: kimi --wire
  -> newline-delimited JSON-RPC over stdin/stdout
  -> kimi_wire_sdk.InboundMessage
  -> kimiMessageToJs(...)
  -> plain JS event object
  -> cart reducer / UI
```

The reusable native schema is `kimi_wire_sdk.InboundMessage`. The cart-facing
schema is the smaller object shape returned by `__kimi_poll()`.

## Build And Registration

Kimi host functions live inside the broader SDK binding:

- `v8_app.zig` imports `framework/v8_bindings_sdk.zig` only when
  `build_options.has_sdk` is true.
- `build.zig` exposes that as `-Dhas-sdk=true`.
- `framework/v8_bindings_sdk.zig` registers `__kimi_init`, `__kimi_send`,
  `__kimi_poll`, and `__kimi_close` from `registerSdk`.

`scripts/ship` gets `-Dhas-sdk=true` from `sdk/dependency-registry.json`.
Today the `sdk` feature is triggered by shipped hook files such as:

- `runtime/hooks/http.ts`
- `runtime/hooks/browser_page.ts`
- `runtime/hooks/useLocalChat.ts`
- `runtime/hooks/useClaudeChat.ts`
- `runtime/hooks/useBrowse.ts`

There is no current `runtime/hooks/useKimiChat.ts`, and the registry does not
list a Kimi hook trigger. Direct cart code that references `__kimi_*` without
also importing an SDK-triggering hook may not enable `has-sdk` in a production
ship build. Dev hosts that force all gates on do not expose that gap.

Implementation note: `v8_app.zig` iterates the ingredient table and then calls
`v8_bindings_sdk.registerSdk({})` again. When `has_sdk` is true the SDK globals
are registered twice to the same callbacks; when `has_sdk` is false the import
is a stub and no Kimi globals are installed.

## Cart API

Registered globals:

```ts
__kimi_init(cwd: string, model?: string, sessionId?: string): boolean;
__kimi_send(text: string): boolean;
__kimi_poll(): KimiEvent | undefined;
__kimi_close(): void;
```

### `__kimi_init`

`hostKimiInit` requires a `cwd`. If the singleton `g_kimi_session` is already
set, it returns `true` and does not change cwd, model, or session id.

For a new session it builds:

```zig
kimi_wire_sdk.SessionOptions{
    .cwd = cwd,
    .model = model,
    .session_id = session_id,
    .yolo = true,
    .inherit_stderr = true,
}
```

It then spawns the CLI, sends the wire `initialize` request immediately, resets
the turn buffers, stores the session globally, and returns `true`. Any spawn or
initialize failure returns `false`.

Empty `sessionId` strings are treated as null. The JS API does not expose the
rest of `SessionOptions`, including `continue_session`, `add_dirs`,
`plan_mode`, `thinking`, `mcp_config_files`, `kimi_bin`, or
`launch_args_override`.

### `__kimi_send`

`hostKimiSend(text)` requires an active singleton session. It resets the
turn-local assistant/thinking buffers and calls:

```zig
g_kimi_session.?.prompt(.{ .text = text })
```

The underlying wire method is JSON-RPC `prompt` with params:

```json
{"user_input":"..."}
```

The request token is discarded after the write; completion is observed later
through `__kimi_poll()`. If sending fails, the native session is deinitialized,
the singleton is cleared, the turn buffers are deinitialized, and the function
returns `false`.

### `__kimi_poll`

`hostKimiPoll()` reads at most one parsed inbound message and returns one plain
JS object. If no line is available it returns `undefined`.

If the child process has closed, polling deinitializes the session, clears the
singleton, deinitializes the turn buffers, and returns `undefined`.

Polling errors are swallowed as `undefined`; callers do not receive the native
error name.

### `__kimi_close`

`hostKimiClose()` closes stdin, waits for the child process through
`Session.close()`, deinitializes the session, clears the singleton, deinitializes
turn buffers, and returns `undefined`.

## JS Poll Event Surface

`kimiMessageToJs` converts `kimi_wire_sdk.InboundMessage` values to compact
objects keyed by `type`.

### Turn And Usage Events

```ts
{ type: "turn_begin", text?: string }
{ type: "status", status: "turn_end" }
{
  type: "usage",
  input_tokens: number,
  output_tokens: number,
  cache_creation_input_tokens: number,
  cache_read_input_tokens: number,
}
```

`TurnBegin` also resets the native turn buffers. `StatusUpdate` reads Kimi token
usage fields from `payload.token_usage`:

- `input_other`
- `output`
- `input_cache_creation`
- `input_cache_read`

### Assistant Content

```ts
{ type: "assistant_part", part_type: "text", text?: string }
{ type: "assistant_part", part_type: "thinking", text?: string }
{ type: "assistant_part", part_type: string, text?: string }
```

For `ContentPart`, `payload.type === "text"` appends to the assistant buffer.
`payload.type === "think"` or `"thinking"` appends to the thinking buffer.
Unknown content parts still become `assistant_part`; if display text can be
extracted, they fall back to `part_type: "text"`.

Display text is extracted from common payload fields: `text`, `content`,
`message`, `response`, `delta`, `markdown`, `think`, or text entries inside
array-valued `content`, `output`, `parts`, or `delta`.

`PlanDisplay` and any event name ending in `Display` are also converted to
assistant text when display text can be extracted.

### Tool And Request Events

```ts
{ type: "tool_call", name?: string, input_json?: string }
{ type: "tool_result", text?: string, is_error: boolean }
{ type: "status", status: "ApprovalRequest", text?: string }
{ type: "status", status: "QuestionRequest", text?: string }
{ type: "status", status: "HookRequest", text?: string }
```

Wire `ToolCall` events read `payload.function.name` and stringify
`payload.function.arguments` into `input_json`.

Wire `ToolCallPart` events return:

```ts
{ type: "tool_call", name: "tool_delta", input_json?: string }
```

Wire `ToolCallRequest` requests also become `tool_call` objects, using
`payload.name` and string-valued `payload.arguments`.

The low-level Zig SDK can respond to approval, tool, question, and hook
requests. The current V8 JS API does not expose those response methods.

### Status And Result Events

```ts
{ type: "status", status?: string, text?: string, is_error?: boolean, payload_json?: string }
{ type: "result", status?: string, result?: string, thinking?: string, is_error: boolean }
```

`BtwBegin` and `BtwEnd` become status objects with optional `text`; `BtwEnd`
sets `is_error: true` when the payload has `error`.

Unknown Kimi events become:

```ts
{ type: "status", status: eventName, payload_json?: string }
```

JSON-RPC responses become `result` objects. If the response is successful and
the assistant turn buffer has text, `result` is the accumulated assistant text.
Otherwise `result` falls back to the stringified JSON-RPC result. If the
thinking buffer has text, it is returned as `thinking`.

## Zig Wire SDK

`framework/kimi_wire_sdk.zig` is transport-first. It owns process lifecycle,
JSON-RPC request construction, line buffering, parsing, and typed response
helpers.

### Session Options

```zig
pub const SessionOptions = struct {
    kimi_bin: ?[]const u8 = null,
    launch_args_override: ?[]const []const u8 = null,
    cwd: ?[]const u8 = null,
    add_dirs: []const []const u8 = &.{},
    model: ?[]const u8 = null,
    continue_session: bool = false,
    session_id: ?[]const u8 = null,
    yolo: bool = false,
    plan_mode: bool = false,
    thinking: ?bool = null,
    mcp_config_files: []const []const u8 = &.{},
    inherit_stderr: bool = true,
    max_line_bytes: usize = 8 * 1024 * 1024,
};
```

`Session.init` rejects `continue_session = true` when `session_id` is also set.
If `launch_args_override` is provided, it is used as argv directly. Otherwise
argv starts with:

```text
kimi --wire
```

and optional flags are appended:

```text
--work-dir <cwd>
--add-dir <path>                 repeated
--model <model>
--session <session_id>
--continue
--yolo
--plan
--thinking | --no-thinking
--mcp-config-file <path>          repeated
```

The child process uses piped stdin/stdout. Stderr is inherited by default.
Stdout ownership moves to the shared `ChildStdout` injected-Io reader task and
bounded queue after spawn; no descriptor flags are changed.

### Initialize

`Session.initialize` sends JSON-RPC method `initialize` and waits for its
matching response before returning:

```zig
pub const InitializeResult = struct {
    protocol_version: []const u8,
    server_name: []const u8,
    server_version: []const u8,
    supports_question: bool = false,
};
```

Default initialize params are:

```zig
protocol_version = "1.9"
client_name = "reactjit_kimi_wire_sdk"
client_version = "0.1.0"
supports_question = false
supports_plan_mode = false
external_tools_json = null
hooks_json = null
```

`initialize` errors if the matching response is an RPC error or lacks
`protocol_version`, `server.name`, or `server.version`.

### Outbound Methods

The raw Zig session supports more commands than the V8 bridge exposes:

```zig
prompt(input: UserInput) RequestToken       // method "prompt"
steer(input: UserInput) RequestToken        // method "steer"
replay() RequestToken                       // method "replay"
cancel() RequestToken                       // method "cancel"
setPlanMode(enabled: bool) RequestToken     // method "set_plan_mode"
```

`UserInput` can be text or prebuilt JSON:

```zig
pub const UserInput = union(enum) {
    text: []const u8,
    json: []const u8,
};
```

Every outbound request is a newline-terminated JSON-RPC object:

```json
{"jsonrpc":"2.0","method":"prompt","id":"reactjit-kimi-1","params":{"user_input":"..."}}
```

Request ids are generated as `reactjit-kimi-{seq}`.

### Inbound Parsing

`parseInboundJson` accepts three wire envelope forms:

```json
{"jsonrpc":"2.0","method":"event","params":{"type":"ContentPart","payload":{}}}
{"jsonrpc":"2.0","method":"request","id":"abc","params":{"type":"ToolCallRequest","payload":{}}}
{"jsonrpc":"2.0","id":"reactjit-kimi-1","result":{"status":"finished"}}
```

They become:

```zig
pub const InboundMessage = union(enum) {
    event: Event,
    request: Request,
    response: Response,
};
```

`Event` stores `event_type` and arbitrary JSON `payload`. `Request` stores the
JSON-RPC id, `request_type`, arbitrary JSON `payload`, and exposes
`payloadId()` for inner Kimi request ids. `Response` stores the JSON-RPC id,
optional `result`, and optional `error_code` / `error_message`.

`poll()` first drains queued inbound messages, then drains complete lines from
`ReadBuffer`, then drains bytes already available from the shared
`ChildStdout` owner. Its cancelable `std.Io.Group` reader task feeds a bounded
`std.Io.Queue`, so frame-facing polling never changes descriptor flags or waits
on fd readiness. Invalid JSON lines are ignored. Oversized lines return
`error.LineTooLong` once the buffer exceeds `max_line_bytes`.

`waitForResponse(request_id)` repeatedly calls `poll()`, returns the matching
response, and queues nonmatching inbound messages for later polling. It sleeps
1 ms between polls.

### Request Response Helpers

The raw Zig SDK can answer agent-originated requests:

```zig
respondApproval(request, decision, feedback)
respondToolCall(request, return_value_json)
respondQuestion(request, answers_json)
respondHook(request, action, reason)
```

These validate the request type, extract the inner Kimi payload id, and write a
JSON-RPC response to the original JSON-RPC request id.

Supported enums:

```zig
ApprovalDecision = approve | approve_for_session | reject
HookAction = allow | block
```

Again, these helpers are not currently exposed as `__kimi_*` host functions.

## Worker Contract Path

`framework/worker_contract.zig` can ingest the raw typed Kimi messages directly:

```text
kimi --wire
  -> framework/kimi_wire_sdk.zig InboundMessage
  -> WorkerStore.bindKimiSession(...)
  -> WorkerStore.ingestKimiWireMessage(...)
  -> WorkerEvent rows / WorkerSnapshot
```

`bindKimiSession(external_session_id, model, reason_started)` starts or updates
a `kimi_cli_wire` session episode.

`ingestKimiWireMessage` maps Kimi events into normalized worker events:

| Kimi wire input | Worker event |
| --- | --- |
| `TurnBegin` | `user_message`, phase `turn_begin`, increments turn count |
| `SteerInput` | `user_message`, phase `steer` |
| `TurnEnd` | `completion`, phase `turn_end` |
| `StatusUpdate` with usage | `usage`, phase `status_update` |
| `StatusUpdate` without usage | `status`, phase `status_update` |
| `ContentPart` text | `assistant_message`, phase `text` |
| `ContentPart` think | `reasoning`, phase `think` |
| `ToolCall` | `tool_call`, phase `tool_call` |
| `ToolCallPart` | `tool_call`, phase `tool_call_delta` |
| `ToolResult` | `tool_output`, phase `tool_result` |
| `PlanDisplay` | `assistant_message`, phase `plan` |
| `BtwBegin` | `status`, phase `btw_begin` |
| `BtwEnd` with response | `assistant_message`, phase `btw_end` |
| `BtwEnd` with error | `error_`, phase `btw_end` |
| known lifecycle events | `status` |
| unknown events | `raw` |
| `ToolCallRequest` | `tool_call`, phase `tool_request` |
| `ApprovalRequest` | `status`, phase `approval_request` |
| `QuestionRequest` | `status`, phase `question_request` |
| `HookRequest` | `status`, phase `hook_request` |
| RPC response error | `error_`, phase `rpc_response` |
| RPC response status | `kindForKimiResponseStatus(status)`, phase `rpc_response` |

This worker contract is native-side normalization. The current V8 cart-facing
`__kimi_poll()` path does not route through `WorkerStore`; older cockpit code
polls `__kimi_*` directly and reduces the compact JS event objects itself.

## Ownership And Lifecycle

- `g_kimi_session` is a process-global singleton inside the V8 SDK binding.
  Multiple independent Kimi sessions in one cart process are not modeled by the
  JS host API.
- `kimi_wire_sdk.Session.deinit()` kills the child if it has not been closed,
  deinitializes queued inbound message arenas, frees the read buffer, and frees
  the last RPC error string.
- `Session.close()` closes stdin and waits for the child. `deinit()` after
  `close()` performs the remaining cleanup.
- Inbound messages returned by `poll()` are owned by an arena and must be
  deinitialized after conversion. `hostKimiPoll` does this with `defer
  owned.deinit()`.
- Turn buffers are native `ArrayList(u8)` values used only by the JS bridge to
  accumulate assistant and thinking text for final `result` events.

## Failure Modes And Gaps

- The `kimi` CLI must be discoverable on `PATH` for the JS bridge. The raw Zig
  SDK can use `SessionOptions.kimi_bin`, but `__kimi_init` does not expose it.
- Authentication and account setup are delegated to the external Kimi CLI.
- The JS bridge hardcodes `yolo = true`.
- The JS bridge does not expose `steer`, `replay`, `cancel`, plan mode,
  thinking mode, additional dirs, MCP config files, external tools, hooks, or
  response helpers for Kimi-originated requests.
- `__kimi_poll()` returns one event per call and uses `undefined` for both
  "nothing available" and native polling errors.
- Direct `__kimi_*` use is currently not a dependency-registry trigger for the
  `sdk` feature. A real Kimi hook or feature marker should close that gap.
- This is a CLI wire bridge, not a `KIMI_API_KEY` / Moonshot REST bridge.

## Files

- `framework/kimi_wire_sdk.zig`
- `framework/v8_bindings_sdk.zig`
- `framework/worker_contract.zig`
- `v8_app.zig`
- `build.zig`
- `scripts/ship`
- `scripts/ship-metafile-gate.js`
- `scripts/sdk-dependency-resolve.js`
- `sdk/dependency-registry.json`
