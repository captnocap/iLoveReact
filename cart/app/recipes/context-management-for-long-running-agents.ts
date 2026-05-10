import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "context-management-for-long-running-agents",
  title: "Context Management for Long-Running Agents",
  sourcePath: "cart/app/recipes/context-management-for-long-running-agents.md",
  instructions:
    "Manage context for long-running agents through the unified worker contract. The original recipe relies on Messages API features (compact_20260112, clear_tool_uses_20250919, memory_20250818) that we don't expose — Claude Code runs its own auto-compaction inside the subprocess. Levers we have through useAssistant({ backend: 'claude_code' }): cwd-as-memory, cart-driven session reset (close + remount), cart-side user-message trimming.",
  sections: [
    {
      kind: "paragraph",
      text:
        "Long-running agents accumulate context: user messages, tool outputs, model reasoning. Before any hard limit is reached, context rot sets in — recall quality drops. The original recipe uses three Messages API knobs (compaction, tool-result clearing, memory tool) that don't exist in our subprocess pathway. This recipe is half-aspirational: concepts apply, levers differ.",
    },
    {
      kind: "code-block",
      title: "Strategy availability matrix",
      language: "text",
      code: `Strategy             API surface                        Status in our stack
───────────────────  ─────────────────────────────────  ─────────────────────────────────
Compaction           compact_20260112                   not exposed; Claude Code auto-compacts
Tool-result clearing clear_tool_uses_20250919           not exposed
Memory tool          memory_20250818                    cwd + Read/Edit/Write is the analog`,
    },
    {
      kind: "bullet-list",
      title: "What we can do today",
      items: [
        "Use cwd as a memory store — same shape as the shopper recipe.",
        "End a session and start a new one by calling close() on the useAssistant return + remounting (or toggling the backend opts so the hook respawns the worker). Carry state forward via files.",
        "Trim our own user-message bloat before ask(). Everything to the left of the hook is ours to shape.",
      ],
    },
    {
      kind: "bullet-list",
      title: "What we can't do today",
      items: [
        "Mid-session compaction triggered by token thresholds.",
        "Selective tool-result clearing while preserving tool_use records.",
        "Server-side context-management telemetry (applied_edits, cleared_input_tokens).",
      ],
    },
    {
      kind: "code-block",
      title: "Architecture: where context management actually lives",
      language: "text",
      code: `.tsx cart  ── useAssistant ──>  framework/assistant/worker_bindings.zig
                                  │
                                  └─ framework/assistant/claude_sdk/Session
                                        └─ subprocess: \`claude --input-format stream-json\`
                                              └─ Claude Code's own context manager
                                                    (auto-compaction, /clear, /compact)
                                                    └─ Messages API
                                                          (compact_20260112, clear_tool_uses_20250919)
                                                                ↑
                                              not visible from the cart`,
    },
    {
      kind: "code-block",
      title: "Strategy 1: cart-side memory via cwd + notes.md",
      language: "tsx",
      code: `import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

const NOTES_INSTRUCTION = \`You are a research analyst. Treat ./notes.md as your durable scratchpad.

At the start of every conversation:
1. Read ./notes.md if it exists.
2. When you reach a meaningful conclusion, append it to ./notes.md with a short header.
3. When something supersedes a prior note, Edit the relevant section in place.

Keep entries short, dated when relevant, and skimmable.\`;

function useAnalyst(cwd: string, model: string) {
  return useAssistant({ backend: 'claude_code', cwd, model });
}`,
    },
    {
      kind: "code-block",
      title: "Strategy 2: cart-driven session reset",
      language: "tsx",
      code: `// Closest analog to compaction we have: drop the worker, respawn it.
// The new worker has zero conversation history. Anything important must
// already be in notes.md.
//
// useAssistant respawns its worker whenever a load-bearing opt changes
// (cwd / model / sessionId / etc.) — bumping a 'sessionEpoch' state value
// passed via opts.sessionId is enough to force a clean reset.

const [epoch, setEpoch] = useState(0);
const { events, ask, close } = useAssistant({
  backend: 'claude_code',
  cwd,
  model,
  sessionId: \`epoch-\${epoch}\`,
});

function resetSession() { setEpoch(n => n + 1); }`,
    },
    {
      kind: "code-block",
      title: "Strategy 2a: ask Claude to summarize before close",
      language: "tsx",
      code: `// Send the summary turn, wait for completion, then bump the epoch.
async function summarizeAndReset() {
  ask(
    "Before we wrap, write a 5-bullet summary of what you've learned this " +
    "session into ./notes.md under a new dated heading. Then say 'done'.",
  );
  // Watch events for the next 'completion' kind, then:
  //   close();      // optional — the hook tears down on opts change anyway
  //   setEpoch(n => n + 1);
}`,
    },
    {
      kind: "code-block",
      title: "Strategy 2b: cart owns the rolling summary",
      language: "typescript",
      code: `// Cheaper and predictable. We accumulate assistant text turn by turn
// (read it off the events array), keep a rolling summary in JS state,
// prepend to next session's first user message. No Claude involvement
// at the boundary.

let runningSummary = '';

function nextPrompt(userMsg: string): string {
  return runningSummary
    ? \`Prior context summary:\\n\${runningSummary}\\n\\nUser: \${userMsg}\`
    : userMsg;
}`,
    },
    {
      kind: "code-block",
      title: "Strategy 3: trim user-message bloat in the cart",
      language: "typescript",
      code: `interface CartTurn {
  role: 'user' | 'assistant';
  text: string;
  toolOutputs: Array<{ name: string; output: string }>;
  ts: number;
}

// Closest thing to "tool-result clearing" we have. We control what goes
// into the session, not what gets evicted from it.
function trimForSend(history: CartTurn[], keepRecent = 4): string {
  const recent = history.slice(-keepRecent);
  const lines: string[] = [];
  for (const t of recent) {
    lines.push(\`[\${t.role}] \${t.text}\`);
    for (const tool of t.toolOutputs) {
      lines.push(\`  [tool \${tool.name}] \${tool.output.slice(0, 400)}\`);
    }
  }
  return lines.join('\\n');
}`,
    },
    {
      kind: "code-block",
      title: "Observability — what the events array surfaces",
      language: "typescript",
      code: `// Each WorkerEvent in \`events\` carries a normalized shape:
//   - kind: 'completion' | 'usage' | 'assistant_message' | 'tool_call' | ...
//   - usage?: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
//   - cost_usd_delta?: number
//
// Sum cost_usd_delta across the run for a "session is getting expensive"
// signal; count completion events for "num_turns". Reset when either
// crosses a workload-specific threshold.

const numTurns = events.filter(e => e.kind === 'completion').length;
const totalCostUsd = events.reduce((sum, e) => sum + (e.cost_usd_delta ?? 0), 0);`,
    },
    {
      kind: "bullet-list",
      title: "Caveats and TODOs against the worker bindings",
      items: [
        "No betas plumbing. framework/assistant/claude_sdk/argv.zig doesn't pass --beta flags. compact_20260112 / clear_tool_uses_20250919 live on client.beta.messages.create — we don't call that.",
        "No mid-session context_management config. Messages API takes context_management.edits per request; Claude Code applies its own policy and hides the knobs.",
        "No slash-command path. The worker's send fn passes raw user text. If we route a leading '/' into Claude Code's slash-command surface, /clear and /compact become cart-driven primitives.",
        "Token telemetry partial. cache_read_input_tokens and cache_creation_input_tokens are already on WorkerEventUsage in framework/assistant/worker_bindings.zig — surface them in cart UI when token-trajectory plots become useful.",
      ],
    },
    {
      kind: "bullet-list",
      title: "Pattern summary",
      items: [
        "Treat cwd + a known notes file as your memory tool.",
        "Reset (bump sessionId / remount) when numTurns or totalCostUsd crosses a threshold; carry state via files.",
        "Optionally have Claude write a summary into notes.md before reset so the next session starts informed.",
        "Trim cart-side history before ask() to control what enters the session.",
        "Treat Claude Code's own auto-compaction as opaque until we plumb the Messages API or slash commands.",
      ],
    },
  ],
};
