# Claude SDK Pipeline (V8 Runtime)

The V8 Claude path is a subprocess bridge to the local `claude` CLI in
`stream-json` mode. It is not the browser, not the Anthropic HTTP Messages API,
and not a DOM/WebSocket transport. JS calls four host functions, Zig owns one
long-lived `claude` child process, and the cart polls parsed NDJSON events back
into React state.

The practical layers:

- `runtime/hooks/useClaudeChat.ts` is the React hook surface.
- `framework/v8_bindings_sdk.zig` exposes `__claude_*` host functions.
- `framework/assistant/claude_sdk/session.zig` spawns and drives the `claude` CLI.
- `framework/assistant/claude_sdk/parser.zig` converts CLI NDJSON lines into typed Zig
  messages.
- `framework/v8_bindings_sdk.zig` converts typed Zig messages into plain JS
  objects.

## Public API

### `useClaudeChat`

Import:

```ts
import { useClaudeChat } from '@reactjit/runtime/hooks/useClaudeChat';
```

Shape:

```ts
type ClaudeChatPhase =
  | 'init'
  | 'loading'
  | 'loaded'
  | 'generating'
  | 'idle'
  | 'failed';

type UseClaudeChatOpts = {
  cwd?: string;            // subprocess working directory
  model?: string;          // CLI model id; default claude-opus-4-7 in hook
  resumeSession?: string;  // passed to claude --resume
  configDir?: string;      // forwarded as CLAUDE_CONFIG_DIR
  pollMs?: number;         // default 100
  persistAcrossUnmount?: boolean; // default true
};

type ClaudeAskOpts = {
  onPart?: (partial: string) => void;
};

type UseClaudeChatResult = {
  phase: ClaudeChatPhase;
  ready: boolean;
  error: string | null;
  lastStatus: string;
  pulse: number;
  streaming: string;
  ask: (text: string, opts?: ClaudeAskOpts) => Promise<string>;
  isAvailable: () => boolean;
};
```

Minimal use:

```tsx
const chat = useClaudeChat({
  cwd: '/home/me/project',
  model: 'claude-opus-4-7',
  configDir: '/home/me/.claude',
});

async function run() {
  if (!chat.ready) return;
  const reply = await chat.ask('Review the changed files.', {
    onPart: (partial) => setDraft(partial),
  });
}
```

`ask()` allows one in-flight request per hook. A second call rejects until the
first resolves.

### `useAssistantChat`

`cart/app/chat/useAssistantChat.ts` is the app-level routing layer. It reads:

- `Settings.settings_default.defaultConnectionId`
- the selected `Connection` row
- `Settings.settings_default.defaultModelId`

Routing today:

```text
claude-code-cli   -> useClaudeChat({ cwd, model, configDir })
anthropic-api-key -> useClaudeChat({ cwd, model })
local-runtime     -> useLocalChat({ model: local .gguf path })
kimi/openai       -> currently fall through to Claude defaults
```

For `claude-code-cli`, `Connection.credentialRef.locator` is interpreted as the
Claude config directory. `useAssistantChat` expands a leading `~/` or bare `~`
against `$HOME` before passing `configDir`; the Zig SDK does not expand `~`.

## Host Functions

Registered by `framework/v8_bindings_sdk.zig`:

```ts
__claude_init(
  cwd: string,
  model?: string,
  resumeSession?: string,
  configDir?: string,
): boolean;

__claude_send(text: string): boolean;
__claude_poll(): ClaudeEvent | undefined;
__claude_close(): void;
```

`__claude_init` creates at most one session per cart process. If
`g_claude_session` is already non-null, the function returns `true` without
changing cwd, model, resume id, or config directory.

The bridge hardcodes these native options:

```zig
.verbose = true,
.permission_mode = .bypass_permissions,
.inherit_stderr = true,
```

The Zig `SessionOptions` type supports more options than the JS bridge exposes:

- `cli_path`
- `system_prompt`
- `allowed_tools`
- `disallowed_tools`
- `permission_mode`
- `max_turns`
- `continue_conversation`
- `add_dirs`

Those are native-only today unless the bridge is extended.

## Event Surface

`__claude_poll()` returns one object per parsed CLI event, or `undefined` when no
complete event is ready.

```ts
type ClaudeEvent =
  | {
      type: 'system';
      session_id: string;
      model?: string;
      cwd?: string;
      tools: string[];
    }
  | {
      type: 'assistant';
      id?: string;
      session_id?: string;
      stop_reason?: string;
      input_tokens: number;
      output_tokens: number;
      content: ClaudeContentBlock[];
      text?: string;      // concatenated text blocks
      thinking?: string;  // concatenated thinking blocks
    }
  | {
      type: 'user';
      session_id?: string;
      content_json: string;
    }
  | {
      type: 'result';
      subtype: 'success' | 'error_result';
      session_id: string;
      result?: string;
      total_cost_usd: number;
      duration_ms: number;
      num_turns: number;
      is_error: boolean;
    };

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input_json: string };
```

The hook uses:

- `assistant.text` to update `streaming` and fire `onPart`.
- `result` to resolve or reject the `ask()` promise.
- `system.model` to update `lastStatus`.
- `user` echoes are intentionally ignored by the hook.

## Build Gate

`sdk/dependency-registry.json` maps `runtime/hooks/useClaudeChat.ts` to the
`sdk` feature. `scripts/ship` turns that into:

```sh
-Dhas-sdk=true
```

`v8_app.zig` imports `framework/v8_bindings_sdk.zig` when
`build_options.has_sdk` is true. The SDK binding registers HTTP/browser-page,
Claude, Kimi, local AI, media recorder/player, IPC, and semantic-tree host
functions.

Implementation note: `v8_app.zig` registers every ingredient through the
`INGREDIENTS` table, then currently calls `v8_bindings_sdk.registerSdk({})`
directly as well. That means the SDK host names are installed twice when SDK is
compiled in; the final global functions still point at the same callbacks.

No Claude-specific native library is bundled by this gate. The runtime expects
the `claude` binary to be discoverable on `PATH` unless a native caller supplies
`SessionOptions.cli_path` directly.

## End-To-End Pipeline

1. The cart imports `useClaudeChat`.

   The import trips the `sdk` feature gate. Without it, `__claude_init` is not
   registered and the hook enters `failed` with:

   ```text
   claude host bindings not registered (framework/v8_bindings_sdk.zig)
   ```

2. The hook initializes the session.

   On first effect run, `useClaudeChat` calls:

   ```ts
   __claude_init(cwd, model, resumeSession, configDir)
   ```

   Defaults at the hook layer:

   - `cwd = ''`
   - `model = 'claude-opus-4-7'`
   - `resumeSession = ''`
   - `configDir = ''`

   If init succeeds, the hook sets phase to `loaded` immediately. The code does
   this intentionally: the CLI may not emit a `system` frame until after the
   first user turn, so waiting for `system` before allowing `ask()` can deadlock
   the first request.

3. The V8 binding creates `SessionOptions`.

   `hostClaudeInit` copies string args, converts empty `resumeSession` and
   empty `configDir` to null, and builds:

   ```zig
   const opts = claude_sdk.SessionOptions{
       .cwd = cwd,
       .model = model,
       .resume_session = resume_session,
       .config_dir = config_dir,
       .verbose = true,
       .permission_mode = .bypass_permissions,
       .inherit_stderr = true,
   };
   ```

   It then calls:

   ```zig
   claude_sdk.Session.init(host.io, host.environ, std.heap.c_allocator, opts)
   ```

   and stores the result in `g_claude_session`.

4. The SDK resolves and spawns the CLI.

   `framework/assistant/claude_sdk/argv.zig` resolves the binary:

   1. `SessionOptions.cli_path`, if provided by native code.
   2. Search every `PATH` entry for `claude`.

   `buildSessionArgv` produces:

   ```text
   claude
     --input-format stream-json
     --output-format stream-json
     --verbose
     --model <model>                    # when model is non-null
     --dangerously-skip-permissions     # for bypass_permissions
     --resume <session_id>              # when resume_session is non-null
   ```

   Other possible native options add `--system-prompt`, `--allowedTools`,
   `--disallowedTools`, `--permission-mode`, `--max-turns`, `--continue`, and
   `--add-dir`, but the JS bridge does not expose those fields today.

5. `Session.init` configures the child process.

   `framework/assistant/claude_sdk/session.zig` receives the root-injected
   `std.Io` capability and environment map, then calls `std.process.spawn(io, …)`
   with:

   - `.cwd = .{ .path = opts.cwd }`
   - `.stdin = .pipe`
   - `.stdout = .pipe`
   - `.stderr = .inherit` when `inherit_stderr` is true

   If `config_dir` is set, it clones the injected environment map, adds:

   ```text
   CLAUDE_CONFIG_DIR=<config_dir>
   ```

   and passes that environment map to the child. This is how a cart can select
   between different Claude auth/session directories.

   After spawn, ownership of the stdout `std.Io.File` moves to `ChildStdout`.
   A cancelable task in an `std.Io.Group` performs blocking
   `readStreaming(io, …)` calls and publishes bytes through a fixed-capacity
   `std.Io.Queue`. The frame-facing poll path only drains bytes already in that
   queue; it does not change descriptor flags or run an fd-readiness loop.

6. `ask(text)` writes a user turn.

   `useClaudeChat.ask()` checks for an existing in-flight request, stores a
   resolve/reject buffer, clears `streaming`, and calls:

   ```ts
   __claude_send(text)
   ```

   The host binding calls `g_claude_session.?.send(text)`.

7. `Session.send` writes stream-json NDJSON.

   The exact outbound envelope is:

   ```json
   {"type":"user","message":{"role":"user","content":"..."},"parent_tool_use_id":null}
   ```

   The prompt is JSON-string escaped, a newline is appended, and the bytes are
   written to the CLI stdin pipe. If the write fails, the session marks itself
   closed and `__claude_send` returns false.

8. The hook polls on an interval.

   Every `pollMs` milliseconds, the hook increments `pulse` and repeatedly calls
   `__claude_poll()` until it returns `undefined`.

   `hostClaudePoll` calls `Session.poll()`. If `poll()` returns null and
   `session.closed` is true, the host binding deinitializes the session and sets
   `g_claude_session = null`.

9. `Session.poll` drains queued stdout without blocking the frame.

   The session owns:

   - a `ChildStdout` owner with a cancelable `std.Io.Group` reader task and a
     bounded byte queue
   - an 8192-byte queue-drain chunk
   - a `ReadBuffer` that accumulates partial stdout bytes
   - a stable `last_line` buffer for the most recently drained line

   Polling loop:

   - drain a complete line from `ReadBuffer` if one exists
   - parse it
   - if no complete line exists, drain bytes currently available from
     `ChildStdout`'s queue
   - return null when the queue is currently empty
   - mark closed after the reader task reports EOF or failure

10. The parser converts one NDJSON line.

   `parseLine` creates an arena allocator per line and calls:

   ```zig
   parser.parseMessage(arena.allocator(), line)
   ```

   Invalid JSON is logged and skipped. Unknown `type` values return null. Valid
   lines become `types.OwnedMessage`; every string slice in the message is owned
   by that message's arena and freed by `OwnedMessage.deinit()`.

11. `parser.zig` recognizes four CLI event types.

   `system`:

   - required `session_id`
   - optional `model`
   - optional `cwd`
   - optional `tools[]`

   `assistant`:

   - nested `message.id`
   - optional top-level `session_id`
   - nested `message.stop_reason`
   - nested `message.usage`
   - content blocks: `text`, `thinking`, `tool_use`

   `user`:

   - optional `session_id`
   - raw JSON string of `message.content`, returned as `content_json`

   `result`:

   - required `session_id`
   - optional `result`
   - `total_cost_usd`
   - `duration_ms`
   - `duration_api_ms`
   - `num_turns`
   - `is_error`
   - `subtype = error_result` when `is_error` is true or CLI subtype is
     `"error"`; otherwise `success`

12. V8 converts the typed message to a JS object.

   `claudeMessageToJs` maps Zig fields to plain JS properties. For assistant
   messages it also builds two convenience strings:

   - `text`: concatenation of all text blocks
   - `thinking`: concatenation of all thinking blocks

   Tool-use blocks are preserved in `content[]` as:

   ```ts
   { type: 'tool_use', id, name, input_json }
   ```

   There is no cart-side tool-result dispatcher in `useClaudeChat` analogous to
   `useLocalChat({ tools })`. Claude Code itself owns its tool runtime.

13. The hook updates React state.

   On `assistant`:

   - append `evt.text` into the in-flight buffer
   - update `streaming`
   - call `onPart(buffer)` if provided
   - set phase to `generating`

   On `result`:

   - if `is_error`, reject the promise and set `error`
   - otherwise resolve the promise with accumulated assistant text, or
     `evt.result` if no assistant text arrived
   - clear `streaming`
   - set phase to `idle`

   On `system`:

   - update `lastStatus` with the model name
   - if phase was still `loading` or `init`, mark loaded and drain any pending
     send queued before readiness

   On `user`:

   - ignored by the hook

14. Cleanup is opt-in by default.

   The hook's cleanup always clears the poll interval. It calls
   `__claude_close()` only when:

   ```ts
   persistAcrossUnmount === false
   ```

   The default is `true`, so dev hot reload and route churn can leave the
   subprocess alive.

   Important: because `initRef` remains true, changing `cwd`, `model`,
   `resumeSession`, or `configDir` on an already-initialized hook does not create
   a new native session unless the old one was closed. To switch model/config
   deliberately, close first or mount with `persistAcrossUnmount: false`.

## Native Types

`framework/assistant/claude_sdk/types.zig` is the stable internal schema:

```zig
pub const ContentBlock = union(enum) {
    text: TextBlock,
    thinking: ThinkingBlock,
    tool_use: ToolUseBlock,
};

pub const Message = union(enum) {
    system: SystemMsg,
    assistant: AssistantMsg,
    user: UserMsg,
    result: ResultMsg,
};

pub const OwnedMessage = struct {
    msg: Message,
    arena: std.heap.ArenaAllocator,
};
```

The arena ownership matters because V8 conversion must finish before
`owned.deinit()` runs in `hostClaudePoll`.

## Important Constraints

- This path wraps the `claude` CLI. It does not call Anthropic's HTTP API
  directly, even when app routing labels the connection `anthropic-api-key`.
- One `g_claude_session` exists per cart process. A second `__claude_init`
  returns true and keeps the existing session.
- The JS bridge exposes only `cwd`, `model`, `resumeSession`, and `configDir`.
  Native `system_prompt`, tool allow/deny lists, `max_turns`, and
  non-bypass permission modes are not bridged.
- The host binding hardcodes `bypass_permissions`, which maps to
  `--dangerously-skip-permissions`.
- `configDir` is passed literally to `CLAUDE_CONFIG_DIR`. Resolve `~` before
  calling the host function.
- `cwd` must be something the OS accepts as the child working directory. The
  native option comment says it should be absolute; the host binding does not
  normalize it.
- `Session.interrupt()` exists natively, but no `__claude_interrupt` host
  function is currently registered.
- Invalid JSON from the CLI is logged and skipped; malformed known event types
  can surface as poll errors and make `__claude_poll()` return `undefined`.
- `useClaudeChat` resolves a turn from accumulated assistant text first. If no
  assistant text was seen, it falls back to `result.result`.

## Related Files

- `runtime/hooks/useClaudeChat.ts`
- `cart/app/chat/useAssistantChat.ts`
- `framework/v8_bindings_sdk.zig`
- `framework/assistant/claude_sdk/mod.zig`
- `framework/assistant/claude_sdk/session.zig`
- `framework/assistant/claude_sdk/child_stdout.zig`
- `framework/assistant/claude_sdk/argv.zig`
- `framework/assistant/claude_sdk/options.zig`
- `framework/assistant/claude_sdk/parser.zig`
- `framework/assistant/claude_sdk/types.zig`
- `framework/assistant/claude_sdk/buffer.zig`
- `sdk/dependency-registry.json`
- `v8_app.zig`
