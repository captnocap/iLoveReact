# Context Management for Long-Running Agents

Long-running agents accumulate context: user messages, tool outputs, model reasoning. Before any hard limit is reached, **context rot** sets in — recall quality drops as old material buries new material. This recipe covers three context strategies and which ones we can actually drive from `useAssistant` today.

The original recipe uses three Anthropic API features:

| Strategy | API surface | Status in our stack |
|---|---|---|
| **Compaction** — summarize and replace transcript | `compact_20260112` in `context_management.edits` | Not exposed. Claude Code has its own auto-compaction we don't currently configure. |
| **Tool-result clearing** — keep recent tool_result, drop older payloads | `clear_tool_uses_20250919` | Not exposed. |
| **Memory tool** — durable cross-session notes via filesystem | `memory_20250818` | We have the *filesystem* (cwd + Read/Edit/Write). The *tool name* is a Claude Code built-in (`Memory`-style behavior emerges from the cwd pattern). |

`useAssistant({ backend: 'claude_code', cwd, model })` drives Claude Code via `framework/assistant/claude_sdk/` over stream-json. The Messages API knobs above live one layer below that — we don't see them, we don't control them. So this recipe ends up half-aspirational: the *concepts* still apply, but the levers we have are different.

## What we can do today

- Use `cwd` as a memory store. Same as `build-agents-that-remember-your-users`: stash durable notes in `notes.md` and let Claude Read/Edit it.
- End a session and start a new one when context feels heavy. Bump `sessionId` (or remount the component) so `useAssistant` respawns the worker against the same `cwd`; you get a clean slate and carry forward any state via files.
- Trim our own user-message bloat before sending. We control everything to the left of `ask()` — strip stale tool outputs, compress prior transcript ourselves.

## What we can't do today

- Mid-session compaction triggered by token thresholds.
- Selective tool-result clearing while keeping tool_use records.
- Server-side context-management telemetry (`applied_edits`, `cleared_input_tokens`).

These need either (a) bypassing Claude Code and calling the Messages API directly from a new Zig binding, or (b) plumbing Claude Code's own `/clear` and `/compact` slash commands through `ask()`. Both are out of scope here; both are flagged in TODOs.

## Architecture

```text
.tsx cart  ── useAssistant ──>  framework/assistant/worker_bindings.zig
                                  │
                                  └─ framework/assistant/claude_sdk/Session
                                        └─ subprocess: `claude --input-format stream-json`
                                              └─ Claude Code's own context manager
                                                    (auto-compaction, /clear, /compact)
                                                    └─ Messages API
                                                          (compact_20260112, clear_tool_uses_20250919)
                                                                ↑
                                              not visible from the cart
```

## Strategy 1: cart-side memory via cwd

Use the same pattern as the shopper recipe — pin Claude to a `notes.md` file:

```typescript
const NOTES_INSTRUCTION = `You are a research analyst. Treat ./notes.md as your durable scratchpad.

At the start of every conversation:
1. Read ./notes.md if it exists.
2. When you reach a meaningful conclusion, append it to ./notes.md with a short header.
3. When something supersedes a prior note, Edit the relevant section in place.

Keep entries short, dated when relevant, and skimmable.`;
```

Send this in front of every turn. Across sessions you get something close to the original recipe's memory tool — the "tool" is just Claude Code's built-in Edit/Write on a known file.

```tsx
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

const { events, ask, phase, close } = useAssistant({
  backend: 'claude_code',
  cwd,
  model: 'claude-sonnet-4-6',
});
```

## Strategy 2: cart-driven session reset

When a turn is wrapping up and you want to start fresh on the next user message, drop the worker and respawn:

```tsx
// useAssistant respawns its worker whenever a load-bearing opt changes.
// Bumping a sessionId is the cheapest reset trigger.
const [epoch, setEpoch] = useState(0);
const { events, ask, close } = useAssistant({
  backend: 'claude_code',
  cwd,
  model,
  sessionId: `epoch-${epoch}`,
});

function resetSession() { setEpoch(n => n + 1); }
```

This is the closest analog we have to compaction: the *new* worker has zero conversation history. Anything important must already be in `notes.md` or wherever you stashed it. Effectively, your durable state is what's on disk.

The original recipe's compaction *preserves* the conversation by replacing it with a summary. We can mimic that one of two ways:

```typescript
// (a) Ask Claude to summarize before we reset.
function summarizeAndReset() {
  ask(
    "Before we wrap, write a 5-bullet summary of what you've learned this " +
    "session into ./notes.md under a new dated heading. Then say 'done'."
  );
  // Watch events for the next 'completion' kind, then bump the epoch.
  // setEpoch(n => n + 1);
}
```

```typescript
// (b) The cart owns the summary. We accumulate assistant text turn by turn
// (read it off events.filter(e => e.kind === 'assistant_message')), keep
// a rolling summary string in JS state, and prepend it to the next session's
// first user message. No Claude involvement at boundary.
let runningSummary = '';
function nextPrompt(userMsg: string): string {
  return runningSummary
    ? `Prior context summary:\n${runningSummary}\n\nUser: ${userMsg}`
    : userMsg;
}
```

(b) is cheaper and predictable; (a) lets Claude pick what's worth keeping. Pick based on whether the session was research-heavy (favor a) or task-heavy (favor b).

## Strategy 3: trim our own user-message bloat

Anything we send via `ask()` is ours to shape. If the cart has been collecting prior turns into a transcript and re-feeding them, trim *before* sending — drop oldest tool outputs, keep recent assistant text and the user's question.

```typescript
interface CartTurn {
  role: 'user' | 'assistant';
  text: string;
  toolOutputs: Array<{ name: string; output: string }>;
  ts: number;
}

function trimForSend(history: CartTurn[], keepRecent = 4): string {
  const recent = history.slice(-keepRecent);
  const lines: string[] = [];
  for (const t of recent) {
    lines.push(`[${t.role}] ${t.text}`);
    for (const tool of t.toolOutputs) {
      lines.push(`  [tool ${tool.name}] ${tool.output.slice(0, 400)}`);
    }
  }
  return lines.join('\n');
}
```

This is the closest thing to "tool-result clearing" we have. We're managing what goes *into* the session, not what gets evicted *from* it. Claude Code on the other side has its own context manager that we just have to trust on hard limits.

## Observability

We don't get `applied_edits` or `cleared_input_tokens`. We do get a normalized `WorkerEvent` stream, with `usage`, `cost_usd_delta`, and `kind === 'completion'` markers we can sum:

```typescript
// from framework/assistant/worker_bindings.zig — populated on completion / usage events
interface WorkerEventUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

const numTurns = events.filter(e => e.kind === 'completion').length;
const totalCostUsd = events.reduce((sum, e) => sum + (e.cost_usd_delta ?? 0), 0);
```

`numTurns` and `totalCostUsd` are your proxies for "is this session getting long / expensive." When they cross a threshold, reset.

## Caveats and TODOs against the worker bindings

- **No `betas` plumbing.** `framework/assistant/claude_sdk/argv.zig` doesn't pass `--beta`-style flags through. The compaction / clearing recipes rely on `betas=["context-management-2025-06-27", "compact-2026-01-12"]` — those land on `client.beta.messages.create`, not Claude Code.
- **No mid-session context_management config.** The Messages API takes `context_management={"edits": [...]}` per request. Claude Code applies its own policy and doesn't expose configuration knobs to wrapped clients.
- **No slash-command path.** The Claude worker's send path passes user text as-is. There's no API for `/clear` / `/compact`. If we ever route a leading `/` into Claude Code's slash-command surface, mid-session compaction becomes a one-liner from the cart.
- **Token telemetry partial.** `cache_read_input_tokens` and `cache_creation_input_tokens` are already on `WorkerEventUsage` but few backends populate them today. Wire the Claude SDK's per-message usage through `worker_contract.zig` to get accurate token-trajectory plots.

## Pattern summary

1. Treat `cwd` + a known notes file as your memory tool.
2. Reset the session (bump `sessionId` / remount) when `numTurns` or `totalCostUsd` crosses a threshold; carry state forward via files.
3. Optionally have Claude write a summary into `notes.md` *before* the reset so the next session starts informed.
4. Trim cart-side history before `ask()` to control what enters the session in the first place.
5. Server-side compaction and clearing happen inside Claude Code; treat them as opaque until we plumb the Messages API or slash commands.

This recipe is a half-port. Part 2 (`context-management-on-a-200k-token-window`) covers the same trade-offs on a tighter context window — same gaps apply, same workarounds work.
