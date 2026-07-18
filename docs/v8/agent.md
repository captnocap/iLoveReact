# Agent System Pipeline (V8 Runtime)

This document covers the `agent*` system end to end: the generic
model-agnostic agent core, its session loop, forked-agent pool, tool
executor, built-in tools, TypeScript API declaration surface, and the current
V8 exposure boundary.

The short version: this system is mostly a Zig framework and typed API shape
today. It is not the same thing as the live Claude, Codex, or Kimi SDK bridges.
Those backend-specific bridges have registered V8 host functions. The generic
`agent*` system does not currently register a V8 `__agent_*` host API.

## Source Map

Core files:

- `framework/agent_core.zig`
- `framework/agent_session.zig`
- `framework/agent_spawner.zig`
- `framework/tool_framework.zig`
- `framework/tools_builtin.zig`
- `framework/api_types/agent.d.ts`
- `framework/api_types/tools.d.ts`

Context files:

- `docs/v8/v8_bindings_sdk.md`
- `cart/app/docs/10-current-substrate.md`
- `framework/v8_bindings_sdk.zig`
- `framework/qjs_runtime.zig`
- `framework/process.zig`
- `framework/pty.zig`

Read-only historical counterparts exist under `tsz/`; do not update those for
the current ReactJIT implementation.

## Current Runtime Status

There are three separate surfaces that are easy to conflate:

1. The generic Zig framework:
   - `agent_core.zig`
   - `agent_session.zig`
   - `agent_spawner.zig`
   - `tool_framework.zig`
   - `tools_builtin.zig`

2. The TypeScript declaration surface:
   - `@reactjit/agent`
   - `@reactjit/tools`
   - defined in `framework/api_types/agent.d.ts` and
     `framework/api_types/tools.d.ts`

3. The V8 host-function surface:
   - `framework/v8_bindings_sdk.zig` registers HTTP, browser, playback,
     recording, IPC, and semantic-tree host functions
   - it does not register Claude, Kimi, or any generic `agent*` functions

There are no `__claude_*` or `__kimi_*` V8 registrations in
`framework/v8_bindings_sdk.zig`. Those host functions exist only in
`framework/qjs_runtime.zig` (the QuickJS runtime), which registers:

```text
__claude_init / __claude_send / __claude_poll / __claude_close
__kimi_init   / __kimi_send   / __kimi_poll   / __kimi_close
```

For the V8 surface that this document covers, the Claude and Kimi SDK
bindings are simply absent. There is also no current V8 registration for:

```text
__agent_init
__agent_send
__agent_poll
__agent_close
__agent_core_create_session
__agent_core_fork_agent
useAgentSession
forkAgent
createAgentPool
```

The exported C functions in the generic agent modules are real exported Zig
symbols, but there is no V8 binding layer that wraps them into JavaScript
globals today.

## High-Level Pipeline

Intended generic agent flow:

```text
TypeScript app
  -> @reactjit/agent API shape
  -> host binding or FFI shim
  -> agent_core.zig
  -> AgentSession
  -> Provider.formatRequest()
  -> streaming provider transport
  -> Provider.parseStreamChunk()
  -> assistant Message + ToolCall list
  -> ToolExecutor
  -> tools_builtin / registered tools
  -> tool result Messages
  -> repeat until no tool calls or max_tool_rounds
```

Current implemented flow:

```text
Zig caller
  -> AgentSession.create(config with Provider vtable)
  -> sendMessage(content)
  -> runAgentLoop()
  -> streamRound()
  -> placeholder transport path
  -> empty assistant message
  -> loop exits because no tool calls were produced
```

The orchestration data structures are described as placeholder code in
`AgentSession.streamRound()`: it asks the provider to format an HTTP request,
discards it, and returns an assistant message built from empty buffers,
without performing HTTP streaming, feeding SSE chunks into
`Provider.parseStreamChunk()`, or invoking stream callbacks.

Note: as of this writing, `framework/agent_session.zig` does not exist in the
active framework at all. The file has been moved to `tsz/framework/agent_session.zig`
(archived, read-only). The "current implemented flow" above therefore
describes the archived `tsz/` copy, not anything currently compiled into the
V8 runtime — the gap between intended and implemented is even wider than the
placeholder wording suggests.

## Agent Core

`framework/agent_core.zig` is the top-level facade module.

It re-exports:

- From `agent_session.zig`:
  - `AgentSession`
  - `SessionConfig`
  - `SessionState`
  - `Message`
  - `MessageRole`
  - `ToolCall`
  - `Provider`
  - `StreamDelta`

- From `tool_framework.zig`:
  - `Tool`
  - `ToolResult`
  - `ToolContext`
  - `ProgressUpdate`
  - `ToolRegistry`
  - `ToolExecutor`

- From `agent_spawner.zig`:
  - `ForkedAgent`
  - `ForkConfig`
  - `AgentPool`
  - `AgentContext`
  - `AgentType`

- From `tools_builtin.zig`:
  - `tools_builtin` namespace

It owns two process-global singletons:

```zig
var g_tool_registry: ?ToolRegistry = null;
var g_agent_pool: ?AgentPool = null;
var g_allocator: std.mem.Allocator = std.heap.c_allocator;
```

`init()` lazily initializes the registry and pool. During registry init, it
registers these built-ins:

- `bash`
- `readFile`
- `writeFile`
- `fileEdit`
- `glob`
- `grep`
- `taskCreate`

`deinit()` destroys both singletons.

`getToolRegistry()` and `getAgentPool()` lazily call `init()` if needed, then
return pointers to the singleton values.

## Provider Factory

`agent_core.zig` defines:

```zig
pub const ProviderType = enum {
    anthropic,
    openai,
    custom,
};

pub const ProviderConfig = struct {
    provider_type: ProviderType,
    api_key: []const u8,
    base_url: ?[]const u8 = null,
    model: []const u8,
};
```

The factory is scaffolded:

```zig
pub fn createProvider(config: ProviderConfig) !Provider {
    _ = config;
    return error.NotImplemented;
}
```

Consequence: `agent_core_create_session()` currently cannot create a working
provider through this facade. It calls `createProvider()`, receives
`error.NotImplemented`, and returns `null`.

A caller can still construct `AgentSession` directly if it supplies a valid
`Provider` vtable, but the core facade's provider factory does not yet provide
Anthropic, OpenAI, Ollama, or custom HTTP implementations.

## Session Types

`framework/agent_session.zig` defines the core chat loop model.

Message roles:

```zig
pub const MessageRole = enum { system, user, assistant, tool };
```

Tool call shape:

```zig
pub const ToolCall = struct {
    id: []const u8,
    name: []const u8,
    arguments: []const u8,
};
```

Message shape:

```zig
pub const Message = struct {
    role: MessageRole,
    content: []const u8,
    tool_calls: ?[]const ToolCall = null,
    tool_call_id: ?[]const u8 = null,
    allocator: std.mem.Allocator,
};
```

Every `Message` owns duplicated strings through its allocator. `Message.deinit`
frees:

- `content`
- every `ToolCall.id`
- every `ToolCall.name`
- every `ToolCall.arguments`
- the `tool_calls` slice
- optional `tool_call_id`

Streaming delta shape:

```zig
pub const StreamDelta = struct {
    content: ?[]const u8 = null,
    tool_calls: ?[]const ToolCall = null,
    done: bool = false,
};
```

Provider interface:

```zig
pub const Provider = struct {
    ctx: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        formatRequest: *const fn (
            ctx: *anyopaque,
            messages: []const Message,
            tools: ?[]const Tool,
        ) anyerror!HTTPRequest,

        parseStreamChunk: *const fn (
            ctx: *anyopaque,
            chunk: []const u8,
            delta: *StreamDelta,
        ) anyerror!void,

        deinit: *const fn (ctx: *anyopaque) void,
    };
};
```

HTTP request abstraction:

```zig
pub const HTTPRequest = struct {
    url: []const u8,
    method: []const u8,
    headers: []const Header,
    body: ?[]const u8,
};
```

Session config:

```zig
pub const SessionConfig = struct {
    provider: Provider,
    model: []const u8,
    system_prompt: ?[]const u8 = null,
    tools: ?[]const Tool = null,
    work_dir: ?[]const u8 = null,
    max_tool_rounds: u32 = 10,
    temperature: f32 = 0.7,
    max_tokens: u32 = 4096,
};
```

Session states:

```zig
pub const SessionState = enum {
    idle,
    streaming,
    executing_tools,
    error_,
};
```

Tool execution record:

```zig
pub const ToolExecution = struct {
    id: []const u8,
    tool_name: []const u8,
    status: enum { pending, running, completed, error_ },
    result: ?[]const u8,
    start_time: i64,
    end_time: ?i64,
};
```

## Session Lifecycle

`AgentSession.create(allocator, config)`:

1. Allocates the session.
2. Stores the config by value.
3. Initializes:
   - `messages`
   - `current_streaming_content`
   - `pending_tool_calls`
   - `tool_executor`
   - `active_executions`
4. Appends an initial system message when `config.system_prompt` exists.

`AgentSession.destroy()`:

1. Deinitializes all messages.
2. Frees streaming and pending tool-call buffers.
3. Deinitializes the `ToolExecutor`.
4. Frees active execution strings and results.
5. Calls `config.provider.deinit()`.
6. Destroys the session allocation.

`AgentSession.sendMessage(content)`:

1. Duplicates and appends a user message.
2. Calls `runAgentLoop()`.

`runAgentLoop()`:

1. Loops up to `config.max_tool_rounds`.
2. Sets state to `streaming`.
3. Clears `current_streaming_content`.
4. Calls `streamRound()`.
5. Appends the assistant message returned from `streamRound()`.
6. If no tool calls are present, sets state to `idle` and returns.
7. If tool calls are present:
   - sets state to `executing_tools`
   - calls `executeTools()`
   - appends each tool result message
   - continues to the next model round
8. If max rounds are exhausted, sets state to `idle`.

Current limitation: `streamRound()` is a placeholder. It creates the provider
request, then does not make the HTTP request or parse stream chunks. Because it
returns an assistant message with empty content and no tool calls, the live
session loop exits after one round. (And, as noted above, the file containing
`streamRound()` lives only in `tsz/framework/agent_session.zig` today; the
active framework has no `agent_session.zig` at all, so this loop is not
currently reachable from the V8 runtime.)

## Tool Execution From Session

`AgentSession.executeTools(calls)` handles assistant-requested tool calls.

For each call:

1. `findTool(call.name)` scans `config.tools`.
2. Unknown tools produce a tool message with content:

   ```text
   Unknown tool: <name>
   ```

3. Known tools create a `ToolExecution` record:
   - duplicate `id`
   - duplicate `tool_name`
   - status `running`
   - start timestamp

4. `on_tool_start` is invoked if registered.
5. The tool is executed with:

   ```zig
   self.tool_executor.execute(tool, call.arguments, self.config.work_dir)
   ```

6. The execution record is marked completed.
7. `on_tool_end` is invoked if registered.
8. A `role = .tool` message is appended with:
   - tool result content
   - duplicated `tool_call_id`

Despite the separate queueing executor in `tool_framework.zig`, this session
path uses the simple synchronous `ToolExecutor.execute()` helper. It does not
queue multiple tool calls concurrently from `AgentSession.executeTools()`.

## Session Callbacks

`AgentSession` stores these callbacks:

- `on_stream_chunk`
- `on_tool_start`
- `on_tool_end`
- `on_error`

Setter methods:

- `setOnStreamChunk(cb, ctx)`
- `setOnToolStart(cb, ctx)`
- `setOnToolEnd(cb, ctx)`
- `setOnError(cb, ctx)`

Current limitation: because streaming transport is placeholder code,
`on_stream_chunk` is not driven by `streamRound()`. Tool callbacks can be
driven when `executeTools()` is reached, but the default placeholder streaming
path never produces tool calls.

## Session C Exports

`agent_session.zig` exports a direct C/FFI surface:

```text
agent_session_create(provider_ctx, provider_vtable, model, system_prompt, work_dir)
agent_session_destroy(session)
agent_session_send_message(session, content)
agent_session_get_state(session)
agent_session_set_on_stream_chunk(session, cb, ctx)
```

This lower-level session export is more direct than `agent_core_create_session`
because it accepts an already-constructed provider context and vtable.

The callback wrapper in `agent_session_set_on_stream_chunk()` expects callback
state through the supplied context and pointer casts it back to a C callback.
That shape is a low-level FFI scaffold, not a V8 host-function wrapper.

## Forked Agent Types

`framework/agent_spawner.zig` defines fork/subagent orchestration.

Agent types:

```zig
pub const AgentType = enum { main, subagent, teammate };
```

Thread-local context:

```zig
threadlocal var current_context: ?AgentContext = null;
```

Helpers:

- `getAgentContext()`
- `setAgentContext(ctx)`
- `clearAgentContext()`
- `runWithAgentContext(ctx, T, f)`

Context shape:

```zig
pub const AgentContext = struct {
    agent_id: []const u8,
    parent_session_id: ?[]const u8,
    agent_type: AgentType,
    agent_name: ?[]const u8,
    is_built_in: bool = false,
    invoking_request_id: ?[]const u8 = null,
    invocation_kind: ?enum { spawn, resume } = null,
    invocation_emitted: bool = false,
};
```

Fork config:

```zig
pub const ForkConfig = struct {
    directive: []const u8,
    inherits_context: bool = true,
    inherits_system_prompt: bool = true,
    model: ?[]const u8 = null,
    provider: ?[]const u8 = null,
    work_dir: ?[]const u8 = null,
    tools: ?[]const Tool = null,
    max_turns: u32 = 200,
    use_worktree: bool = false,
    permission_mode: enum { inherit, bubble, isolated } = .bubble,
};
```

Forked-agent status:

```zig
pub const AgentStatus = enum {
    spawning,
    running,
    paused,
    completed,
    error_,
};
```

`ForkedAgent` stores:

- allocator
- `agent_id`
- `parent_session_id`
- `ForkConfig`
- status
- current turn count
- optional in-process `AgentSession`
- optional child `Process`
- copied message history
- optional final report
- exit code
- message, complete, and error callbacks

## Forked Agent Lifecycle

`ForkedAgent.create(allocator, parent_session, config)`:

1. Allocates a `ForkedAgent`.
2. Generates an id:

   ```text
   agent_<milliTimestamp>
   ```

3. Sets `parent_session_id` to the parent session's model string when a parent
   exists. This name is misleading: it stores `ps.config.model`, not a stable
   session id.
4. Initializes an owned message list.
5. If `inherits_context` is true and a parent session exists, clones parent
   messages into the child message list.

The clone duplicates message content and `tool_call_id`, but explicitly does
not deep-copy assistant `tool_calls`.

`ForkedAgent.start()`:

1. Sets status to `running`.
2. Installs an `AgentContext` with:
   - `agent_type = .subagent`
   - `agent_name = "fork"`
   - `is_built_in = true`
   - `invocation_kind = .spawn`
3. Builds forked messages with `buildForkedMessages()`.
4. Frees those built messages after local use.
5. Logs startup.

Current limitation: `start()` does not create a session, spawn a process, or
run the child directive. The execution body is scaffolded.

`ForkedAgent.sendMessage(content)`:

1. Requires status `running` or `paused`.
2. Appends a user message.
3. If a current agent context exists, marks it as resume:
   - `invocation_kind = .resume`
   - `invocation_emitted = false`
4. Does not yet continue the session; the code contains a placeholder.

`pause()` sets status to `paused`.

`resume()` sets status to `running`.

`terminate()` sets status to `completed`, then terminates and closes
`child_process` if one exists.

`destroy()` frees:

- `agent_id`
- cloned messages
- optional final report
- optional nested session
- the `ForkedAgent` allocation

## Forked Message Construction

`buildForkedMessages()` tries to preserve a cache-shareable prefix.

No parent context:

```text
user: <child directive wrapper>
```

Parent context exists:

1. Find the last assistant message.
2. Clone all messages up to and including that assistant message.
3. Build the child directive wrapper.
4. If the assistant had tool calls, synthesize placeholder tool-result text:

   ```text
   Fork started - processing in background
   ```

5. Append one final user message containing:
   - tool result summaries
   - the child directive wrapper

The child directive begins with:

```text
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.
```

It also instructs the fork to execute directly, avoid subagents, use tools,
stay within scope, commit modifications, and report using fixed labels.

This is prompt-shaping infrastructure only. It does not currently launch a
real child run by itself.

## Agent Pool

`AgentPool` owns forked agents:

```zig
pub const AgentPool = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    agents: std.StringHashMap(*ForkedAgent),
    mutex: std.Io.Mutex,
};
```

Operations:

- `init(io, allocator)`
- `deinit()`
- `spawn(parent_session, config)`
- `get(agent_id)`
- `terminateAll()`
- `list(out)`

`spawn()`:

1. Locks the mutex.
2. Creates a `ForkedAgent`.
3. Inserts it into `agents` by id.
4. Calls `agent.start()`.
5. Returns the agent pointer.

Because `start()` is scaffolded, pool spawn currently creates and registers a
running-status fork handle, but not an active child agent process or session.

## Forked Agent C Exports

`agent_spawner.zig` exports:

```text
agent_pool_create()
agent_pool_destroy(pool)
agent_pool_spawn(pool, directive, inherits_context, use_worktree)
forked_agent_send_message(agent, content)
forked_agent_terminate(agent)
forked_agent_get_status(agent)
```

These are C/FFI exports. They are not registered as V8 globals today.

## Tool Framework

`framework/tool_framework.zig` provides model-agnostic tool execution.

Tool input schema:

```zig
pub const ToolInputSchema = struct {
    type: []const u8 = "object",
    properties: ?std.json.ObjectMap = null,
    required: ?[][]const u8 = null,
};
```

Tool result:

```zig
pub const ToolResult = struct {
    content: []const u8,
    is_error: bool = false,
};
```

Progress update:

```zig
pub const ProgressUpdate = struct {
    tool_use_id: []const u8,
    status: enum { pending, running, progress, completed, error_ },
    message: ?[]const u8 = null,
    percent: ?u8 = null,
};
```

Tool context:

```zig
pub const ToolContext = struct {
    allocator: std.mem.Allocator,
    work_dir: ?[]const u8,
    tool_use_id: []const u8,
    on_progress: ?*const fn (ctx: ?*anyopaque, update: ProgressUpdate) void,
    on_progress_ctx: ?*anyopaque,
    should_abort: *const fn (ctx: ?*anyopaque) bool,
    should_abort_ctx: ?*anyopaque,
};
```

Tool shape:

```zig
pub const Tool = struct {
    name: []const u8,
    description: []const u8,
    input_schema: ToolInputSchema,
    execute: ToolExecuteFn,
    validate: ?ToolValidateFn = null,
    isConcurrencySafeFn: *const fn (input_json: []const u8) bool,
    isReadOnlyFn: *const fn (input_json: []const u8) bool,
    isDestructiveFn: ?*const fn (input_json: []const u8) bool = null,
    modifiesShellStateFn: ?*const fn (input_json: []const u8) bool = null,
};
```

Policy helpers:

- `isConcurrencySafe(input_json)`
- `isReadOnly(input_json)`
- `isDestructive(input_json)`
- `modifiesShellState(input_json)`

## Tool Registry

`ToolRegistry` is a string-keyed map:

```zig
pub const ToolRegistry = struct {
    allocator: std.mem.Allocator,
    tools: std.StringHashMap(Tool),
};
```

Operations:

- `init(allocator)`
- `deinit()`
- `register(tool)`
- `get(name)`
- `unregister(name)`
- `list()`

The registry stores `Tool` values by name. It does not own duplicated copies of
tool name/description strings; callers must ensure those slices remain valid.
The built-in tools use static string literals.

## Tool Executor Queue

`ToolExecutor` supports queued execution with concurrency rules:

```zig
pub const ToolExecutor = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    pending_tools: std.ArrayList(QueuedTool),
    tasks: std.Io.Group,
    mutex: std.Io.Mutex,
    has_errored: bool = false,
    errored_tool_description: ?[]const u8 = null,
    should_abort: std.atomic.Value(bool) = .init(false),
    on_progress: ?*const fn (...) = null,
    on_complete: ?*const fn (...) = null,
};
```

`queue(tool, tool_use_id, input_json, work_dir)`:

1. Duplicates the tool-use id.
2. Duplicates the input JSON.
3. Creates a `ToolContext`.
4. Appends a queued item.
5. Calls `processQueue()`.

`canExecute(tool, input_json)`:

- If no tool is executing, allow.
- If the new tool is concurrency-safe and no exclusive tool is running, allow.
- Otherwise block.

`processQueue()`:

1. Walks queued items in order.
2. Starts any runnable queued tool.
3. If it hits an unsafe queued tool that cannot run yet, stops to preserve
   ordering.

`executeTool(item)`:

1. Marks the item executing.
2. Reports progress.
3. Submits the work to the executor's injected-I/O `std.Io.Group`.
4. Calls the tool's `execute(input_json, context)`.
5. Stores result and marks completed.
6. If the tool name begins with `bash` and returned an error, sets sibling
   abort flags.
7. Invokes `on_complete` when registered.
8. Calls `processQueue()` again.

Other lifecycle methods:

- `waitAll()`
- `getResult(tool_use_id)`
- `cancelAll()`
- `reset()`
- `setOnProgress(cb, ctx)`
- `setOnComplete(cb, ctx)`
- `execute(tool, input_json, work_dir)`

Important distinction: `ToolExecutor.execute()` is a synchronous helper that
does not use the queue. `AgentSession.executeTools()` currently uses this
synchronous helper.

## Tool Framework C Exports

`tool_framework.zig` exports:

```text
tool_registry_create()
tool_registry_destroy(registry)
tool_registry_register(registry, tool)
tool_executor_create()
tool_executor_destroy(exec)
tool_executor_queue(exec, tool, tool_use_id, input_json, work_dir)
tool_executor_wait_all(exec)
tool_executor_reset(exec)
```

These are C exports, not V8 globals.

## Built-In Tools

`framework/tools_builtin.zig` implements the concrete tools registered by
`agent_core.init()`.

### bash

Constructor:

```zig
pub fn bashTool() Tool
```

Input:

```zig
pub const BashInput = struct {
    command: []const u8,
    timeout_ms: ?u32 = null,
    cwd: ?[]const u8 = null,
    env: ?std.json.ObjectMap = null,
};
```

Execution:

1. Parse JSON input.
2. Resolve timeout, defaulting to 30 seconds.
3. Resolve cwd from input or `ToolContext.work_dir`.
4. Open a PTY with shell `bash`.
5. Write `export KEY=VALUE` commands for input env values.
6. Write the requested command plus newline.
7. Loop until timeout or process exit:
   - check abort
   - read available PTY data
   - report periodic progress
   - sleep briefly
8. On timeout, close the PTY and return an error result.
9. Return output, truncated when it exceeds 100,000 bytes.

Policy:

- concurrency unsafe when command contains `&&`, `;`, or shell-state mutators
  (`cd`, `export`, `source`, leading `.`)
- read-only when command starts with known read commands
- destructive when command contains patterns like `rm`, `mv`, `dd`, or
  redirection
- shell-state modifying when it starts with `cd`, `export`, `source`, or `.`

### readFile

Input:

```zig
file_path: []const u8
offset: ?usize = null
limit: ?usize = null
```

Behavior:

- resolves relative paths against `work_dir`
- opens the file
- reads up to `limit * 200` bytes
- splits by newline
- returns numbered lines from `offset` through `offset + limit`
- classified as concurrency-safe and read-only

Default `limit` is 100 lines.

### writeFile

Input:

```zig
file_path: []const u8
content: []const u8
```

Behavior:

- resolves relative paths against `work_dir`
- ensures parent directory exists
- creates or overwrites the file
- writes the full content
- classified as exclusive, not read-only, and destructive

### fileEdit

Input:

```zig
file_path: []const u8
old_string: []const u8
new_string: []const u8
```

Behavior:

- resolves relative paths against `work_dir`
- reads the whole file up to 10 MB
- searches for exact `old_string`
- returns an error result if not found
- writes the replaced content back
- classified as exclusive, not read-only, and destructive

### glob

Input:

```zig
pattern: []const u8
path: ?[]const u8 = null
limit: ?usize = null
```

Behavior:

- resolves search directory from input path, `work_dir`, or `.`
- constructs a shell command using `find`
- spawns `/bin/sh -c <command>`
- currently returns a summary string rather than parsed file output
- classified as concurrency-safe and read-only

### grep

Input:

```zig
pattern: []const u8
path: ?[]const u8 = null
output_line_numbers: ?bool = null
limit: ?usize = null
```

Behavior:

- builds an `rg` command:
  - `rg`
  - `--color=never`
  - optional `-n`
  - `-m <limit>`
  - pattern
  - search path
- spawns `rg`
- currently returns a summary string rather than collected ripgrep output
- classified as concurrency-safe and read-only

### taskCreate

Input:

```zig
command: []const u8
description: ?[]const u8 = null
```

Behavior:

- initializes `TaskRegistry`
- allocates id `task_<n>`
- creates output path `/tmp/tsz_task_<id>.log`
- spawns `/bin/sh -c <command>`
- stores task info in a global map
- returns task id, command, and output path
- classified as concurrency-safe but not read-only

Task registry supports:

- `init(allocator)`
- `createTask(allocator, command, description)`
- `getTask(id)`
- `stopTask(id)`

The public TypeScript declaration includes `taskList` and `taskOutput`, but
the current Zig built-ins only export `taskCreate`.

## Built-In Tool C Exports

`tools_builtin.zig` exports constructors:

```text
tools_builtin_get_bash()
tools_builtin_get_read_file()
tools_builtin_get_write_file()
tools_builtin_get_file_edit()
tools_builtin_get_glob()
tools_builtin_get_grep()
tools_builtin_get_task_create()
```

Again, these are C exports, not V8 globals.

## TypeScript API Surface

`framework/api_types/agent.d.ts` declares `@reactjit/agent`.

Core types:

- `MessageRole`
- `ToolCall`
- `Message`
- `ToolDefinition`
- `Tool`
- `ToolContext`
- `AIProvider`
- `SessionConfig`
- `SessionState`
- `ToolExecution`
- `AgentSession`
- `ForkConfig`
- `ForkedAgentStatus`
- `ForkedAgent`
- `AgentPool`

Declared functions:

```ts
export function useAgentSession(config: SessionConfig): AgentSession;
export function forkAgent(config: ForkConfig): ForkedAgent;
export function forkAgents(configs: ForkConfig[]): Promise<ForkedAgent[]>;
export function createAgentPool(): AgentPool;
```

`framework/api_types/tools.d.ts` declares `@reactjit/tools`.

Declared tool values:

```ts
export const bash: Tool<BashInput, string>;
export const readFile: Tool<ReadFileInput, string>;
export const writeFile: Tool<WriteFileInput, void>;
export const fileEdit: Tool<FileEditInput, void>;
export const glob: Tool<GlobInput, string[]>;
export const grep: Tool<GrepInput, string>;
export const taskCreate: Tool<TaskCreateInput, TaskInfo>;
export const taskList: Tool<TaskListInput, TaskInfo[]>;
export const taskOutput: Tool<TaskOutputInput, string>;
export const taskStop: Tool<TaskStopInput, void>;
export const webSearch: Tool<WebSearchInput, string>;
export const webFetch: Tool<WebFetchInput, string>;
```

Declared helper functions and registry API:

```ts
export function createTool<Input, Output>(config: {...}): Tool<Input, Output>;
export function getToolRegistry(): ToolRegistry;
export function createToolRegistry(): ToolRegistry;
```

Important differences between declarations and Zig implementation:

- `taskList`, `taskOutput`, `taskStop`, `webSearch`, and `webFetch` are
  declared in TypeScript but do not have corresponding constructors in
  `tools_builtin.zig`.
- `createTool`, `getToolRegistry`, and `createToolRegistry` are TypeScript API
  declarations only in the current tree.
- The Zig side exports C constructors for the seven built-ins listed in
  `tools_builtin.zig`, not a JavaScript module implementation.

Important: these `.d.ts` files describe the intended TypeScript API. They do
not by themselves install runtime modules or V8 host functions.

## Agent Core C Exports

`agent_core.zig` exports an aggregate C surface:

```text
agent_core_create_session(provider_type, model, api_key, system_prompt, work_dir)
agent_core_destroy_session(handle)
agent_core_session_send(handle, content)
agent_core_session_set_callbacks(handle, ...)
agent_core_fork_agent(directive, inherits_context, use_worktree)
agent_core_agent_send(handle, content)
agent_core_agent_terminate(handle)
agent_core_agent_set_callbacks(handle, ...)
agent_core_execute_tool_sync(tool_name, input_json, work_dir, out_result, out_is_error)
```

Session creation currently returns `null` because `createProvider()` returns
`error.NotImplemented`.

Fork creation currently returns a registered `ForkedAgent` handle in running
status, but the child execution path is scaffolded.

`agent_core_execute_tool_sync()` is the most concrete export in this facade:

1. Initializes core singletons.
2. Looks up a tool by name in the singleton registry.
3. Creates a temporary `ToolExecutor`.
4. Runs `ToolExecutor.execute()`.
5. Copies the result with `std.heap.c_allocator`.
6. Sets `out_is_error = 0`.

Limitations:

- error status is not propagated into `out_is_error`
- there is no matching exported free function for `out_result`
- the return pointer is a raw C string pointer shape, while the duplicated
  slice is not visibly null-terminated at this call site

## Relationship To Worker Contract

The generic `agent*` system is distinct from `framework/worker_contract.zig`.

`worker_contract.zig` normalizes concrete backend event streams:

- Claude SDK messages
- Codex app-server notifications
- Kimi wire messages

The generic `agent*` system does not currently feed `WorkerStore`. It has its
own callback structs and C exports. A future bridge could map:

- `on_stream_chunk` -> assistant message events
- `on_tool_start` -> tool call/status events
- `on_tool_end` -> tool output events
- `on_error` -> error events
- forked-agent callbacks -> worker/session lifecycle events

That mapping is not present today.

## Relationship To Backend SDK Docs

The current backend-specific docs cover live SDK paths:

- `docs/v8/claude-sdk.md`
- `docs/v8/codex-sdk.md`
- `docs/v8/llamacpp.md`
- `docs/v8/whisper.md`

Those docs trace concrete runtime integrations. This `agent.md` file traces
the generic orchestration layer that could sit above providers, but currently
does not have a complete V8 hook or provider transport.

## End-To-End Current State By Entry

### V8 App Calls `useAgentSession`

Current result: declaration only.

There is no located runtime implementation of `useAgentSession()` and no V8
host binding to back it.

### V8 App Calls `globalThis.__agent_*`

Current result: unavailable.

No `__agent_*` host functions are registered by `v8_bindings_sdk.zig`.

### C/FFI Caller Calls `agent_core_create_session`

Current result: returns `null`.

Reason: `createProvider()` returns `error.NotImplemented`.

### C/FFI Caller Calls `agent_session_create`

Current result: can allocate a session if the caller supplies a valid provider
context and vtable.

But `sendMessage()` still reaches placeholder `streamRound()`, so no actual
provider transport happens in the current code.

### C/FFI Caller Calls `agent_core_execute_tool_sync`

Current result: can dispatch registered built-in tools through the singleton
registry.

This is currently the most usable generic-agent export, with the memory/error
limitations listed above.

### C/FFI Caller Calls `agent_core_fork_agent`

Current result: creates, registers, and starts a `ForkedAgent` handle.

The fork is marked running and has prompt/context scaffolding, but no child
session/process execution is launched.

## Implementation Constraints

- Do not describe `@reactjit/agent` as live V8 runtime API until a binding
  exists.
- Do not add this surface to QJS first; V8 is the default runtime.
- Do not imply `agent_core_create_session` works until `createProvider()` is
  implemented.
- Do not imply `AgentSession.streamRound()` streams model output until HTTP/SSE
  transport is wired.
- Do not imply `forkAgent()` launches parallel child work today; the prompt and
  pool machinery exist, but execution is scaffolded.
- Tool constructors and C exports are useful lower-level pieces, but the JS
  module declarations are not runtime implementations.
- `ToolExecutor.queue()` supports concurrency, but `AgentSession.executeTools()`
  uses the synchronous helper today.
- Built-in `glob` and `grep` spawn commands but currently return summary text,
  not full parsed output.
- Several exported C pointer-return paths need an ownership/free story before
  they are comfortable as public V8 APIs.

## Related Files

- `framework/agent_core.zig`
- `framework/agent_session.zig`
- `framework/agent_spawner.zig`
- `framework/tool_framework.zig`
- `framework/tools_builtin.zig`
- `framework/api_types/agent.d.ts`
- `framework/api_types/tools.d.ts`
- `framework/process.zig`
- `framework/pty.zig`
- `framework/v8_bindings_sdk.zig`
- `framework/qjs_runtime.zig`
- `framework/worker_contract.zig`
- `docs/v8/v8_bindings_sdk.md`
- `docs/v8/claude-sdk.md`
- `docs/v8/codex-sdk.md`
