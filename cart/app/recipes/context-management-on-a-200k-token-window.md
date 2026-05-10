# Context Management for Long-Running Agents (Part 2): On a 200K-token Window

Part 1 (`context-management-for-long-running-agents`) covered the three context strategies — compaction, tool-result clearing, memory — and the gap between the original Anthropic recipe (Messages API) and what `useAssistant` exposes (Claude Code subprocess). Part 2 narrows the lens to a 200K-token window and asks: what changes when you can't comfortably overrun?

## The failure mode shifts

On a 1M model, context bloat shows up as **rot**: older facts get harder to retrieve, prefill cost grows, latency creeps up. The session keeps running.

On a 200K model, it shows up as a **hard stop**: the next request is rejected, the agent halts mid-task. There is no graceful degradation.

Our worker bindings don't see either failure directly — both happen inside the `claude` subprocess. What we *do* see is the normalized `WorkerEvent` stream from `useAssistant`, with `kind: 'completion'` and `kind: 'error_'` markers and a `status_text` field that carries the structured cause:

```typescript
// from runtime/hooks/useAssistant.ts
interface WorkerEvent {
  kind: 'completion' | 'usage' | 'assistant_message' | 'tool_call' | 'error_' | ...;
  status_text?: string;     // 'success' | 'error_max_turns' | etc.
  cost_usd_delta?: number;
  usage?: WorkerEventUsage;
  payload_json?: string;    // full backend payload as JSON
  // ...
}
```

`status_text` on the completion event is the closest thing to a structured cause. Watch for it.

## Strategy: defensive resets before the wall

Without `context_management.edits` we can't trigger compaction on a token threshold. We can do the next-best thing: **reset the worker before context grows past a turn budget we've measured for our workload.**

```tsx
const MAX_TURNS_BEFORE_RESET = 8;
const MAX_COST_BEFORE_RESET  = 0.50; // USD

function useResettingAssistant(cwd: string, model: string) {
  const [epoch, setEpoch] = useState(0);
  const { events, ask, close } = useAssistant({
    backend: 'claude_code',
    cwd, model,
    sessionId: `epoch-${epoch}`,
  });

  const numTurns     = events.filter(e => e.kind === 'completion').length;
  const totalCostUsd = events.reduce((s, e) => s + (e.cost_usd_delta ?? 0), 0);

  useEffect(() => {
    if (numTurns >= MAX_TURNS_BEFORE_RESET || totalCostUsd >= MAX_COST_BEFORE_RESET) {
      askForSessionSummary(ask).then(() => setEpoch(n => n + 1));
    }
  }, [numTurns, totalCostUsd]);

  return { events, ask, close };
}
```

The numbers are workload-specific. Run a few sessions with `MAX_TURNS_BEFORE_RESET = 999` and watch when an `error_` event first appears. Set the threshold to ~70% of that.

## Strategy: cart-driven compaction at boundaries

Before resetting, ask Claude to compress the session into `notes.md`. This is the only "compaction" our stack supports today — Claude doing it explicitly via Edit/Write at our request, *outside* the Messages API.

```typescript
async function askForSessionSummary(ask: (s: string) => boolean) {
  const prompt = `Before we wrap this session, write a compact summary into ./notes.md under a new dated heading.

Include:
- Key decisions and conclusions reached this session.
- Facts learned that we'll need next time (numbers, names, dates).
- Open threads that should be picked up later.

Be concise. Skip verbose tool outputs. Reply 'done' when the file is updated.`;
  ask(prompt);
  // Caller awaits the next `completion` event in the events array, then bumps the epoch.
}
```

`ask()` queues one prompt against the live worker; the cart watches `events` for the next `kind: 'completion'` before triggering the reset.

Then on the next user turn (after the worker has respawned), the cart prepends the summary on its own:

```tsx
import { readFile } from './host';

useEffect(() => {
  if (!ready() || epoch === 0) return;   // first session has no prior summary
  readFile(`${cwd}/notes.md`, 'utf8')
    .catch(() => '')
    .then(summary => {
      const prompt = summary
        ? `Prior session notes:\n${summary}\n\nUser: ${pendingUserMsg}`
        : pendingUserMsg;
      ask(prompt);
    });
}, [ready(), epoch]);
```

You're paying the prefill cost of the summary every fresh session. That's still cheaper than carrying the entire prior transcript.

## Strategy: trim user-message bloat ourselves

Same as Part 1, with a tighter discipline. Anything we send via `ask()` is ours to shape. On a 200K window, we can't afford to re-feed history defensively.

```typescript
interface CartTurn {
  role: 'user' | 'assistant';
  text: string;
  toolOutputs: Array<{ name: string; output: string }>;
}

function trimForSend(history: CartTurn[], keepRecent = 3, headBudget = 600): string {
  const recent = history.slice(-keepRecent);
  const lines: string[] = [];
  for (const t of recent) {
    lines.push(`[${t.role}] ${t.text}`);
    for (const tool of t.toolOutputs) {
      const head = tool.output.slice(0, headBudget);
      const truncated = tool.output.length > headBudget ? '… [truncated]' : '';
      lines.push(`  [tool ${tool.name}] ${head}${truncated}`);
    }
  }
  return lines.join('\n');
}
```

Three knobs: `keepRecent` (how many recent turns), `headBudget` (how much of each tool output survives), and your own threshold for re-sending history at all.

## Decision rubric on a 200K window

- **Skip cart-driven compaction** if the workload is single-question / single-answer; let each session live and die on one turn. Reset every time.
- **Skip the notes file** for sessions that must remain isolated (compliance, eval, sandboxing). Use a per-session tempdir.
- **Always** trim history before `ask()`. The cost-per-turn cliff hits hard near the limit.

## Strategy comparison

| Strategy | Lever in our stack | Cost | Best for |
|---|---|---|---|
| Cart-side reset | bump `sessionId` / remount | Re-init latency (~tens of ms) | Bounded-budget runs |
| Cart-side summary into `notes.md` | `ask("summarize and stop")` | One extra Claude turn | Research that must continue |
| User-message trimming | Cart-side string slicing | Free | Every workload, always |
| Server-side compaction | (not exposed) | — | Out of scope until plumbed |
| Server-side tool-result clearing | (not exposed) | — | Out of scope until plumbed |

## Telemetry we have vs. what we want

| Telemetry | Available | Source |
|---|---|---|
| `numTurns` | yes | `events.filter(e => e.kind === 'completion').length` |
| `totalCostUsd` | yes | `events.reduce((s,e) => s + (e.cost_usd_delta ?? 0), 0)` |
| `duration_ms` | partial | derive from `event.created_at_ms` range |
| `input_tokens` / `output_tokens` per turn | partial | `event.usage` on `usage` / `completion` events (backend-dependent) |
| `cache_read_input_tokens` | partial | `event.usage.cache_read_input_tokens` (Claude SDK doesn't fill it yet) |
| `cache_creation_input_tokens` | partial | same — wire through `framework/assistant/claude_sdk/parser.zig` |
| `applied_edits` (compaction) | no | server-side, hidden |
| `cleared_input_tokens` | no | server-side, hidden |

Plot whatever you have. Start with `numTurns` over wall-clock and watch where the bend happens before failure.

## Caveats and TODOs against the worker bindings

- **No `betas` plumbing.** `framework/assistant/claude_sdk/argv.zig` doesn't pass `--beta` flags. Mid-session compaction (`compact_20260112`) and clearing (`clear_tool_uses_20250919`) live on `client.beta.messages.create`, which we don't call.
- **No slash-command path.** The Claude worker's send fn passes raw user text. If we route a leading `/` into Claude Code's slash-command surface, `/clear` and `/compact` become cart-driven primitives. Open a small ticket here when this is needed.
- **Token usage gaps.** `cache_read_input_tokens` and `cache_creation_input_tokens` exist on `WorkerEventUsage` but the Claude SDK parser doesn't populate them yet — wire them through `framework/assistant/claude_sdk/parser.zig` so the cart can plot real token trajectories.
- **`status_text` enum drift.** The string is not enumerated end-to-end. Capture values as you see them and add typed handling for `error_max_turns`, `error_during_execution`, etc.

## Pattern summary

1. Pick a turn / cost budget below your observed wall.
2. On each `completion` event, decide: continue, reset, or summarize-and-reset.
3. Summarize via `ask()`-driven Edit on `notes.md`; reload it as the prefix of the next session's first `ask()`.
4. Trim cart-side history aggressively before sending — there's no server-side eviction to fall back on.
5. Treat Claude Code's own auto-compaction as opaque; instrument resets, not edits.

The 200K window doesn't change the strategies, only the urgency. Same levers as Part 1, applied earlier and more often.
