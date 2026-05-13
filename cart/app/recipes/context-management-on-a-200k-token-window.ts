import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "context-management-on-a-200k-token-window",
  title: "Context Management for Long-Running Agents (Part 2): On a 200K-token Window",
  sourcePath: "cart/app/recipes/context-management-on-a-200k-token-window.md",
  instructions:
    "Same context-management strategies as Part 1, applied earlier and more often when you can't comfortably overrun. On a 200K window the failure mode is a hard stop, not graceful rot. We can't trigger server-side compaction; we defensively reset before the wall using numTurns / totalCostUsd derived from the useAssistant events stream as proxies, summarize into notes.md at boundaries, and trim cart-side history aggressively.",
  sections: [
    {
      kind: "paragraph",
      text:
        "Part 1 covered the three context strategies and the gap between Anthropic's Messages API features (compact, clear, memory) and our Claude Code subprocess pathway. Part 2 narrows the lens to a 200K-token window: same gaps, more urgency.",
    },
    {
      kind: "bullet-list",
      title: "How the failure mode shifts",
      items: [
        "On a 1M model, context bloat shows up as rot — older facts get harder to retrieve, prefill cost and latency creep up, the session keeps running.",
        "On a 200K model, it shows up as a hard stop — the next request is rejected, the agent halts mid-task. No graceful degradation.",
        "Our worker bindings don't see either failure directly — both happen inside the claude subprocess.",
      ],
    },
    {
      kind: "code-block",
      title: "What we DO see (completion events with structured cause)",
      language: "typescript",
      code: `// from runtime/hooks/useAssistant.ts (WorkerEvent shape)
interface WorkerEvent {
  kind: 'completion' | 'usage' | 'assistant_message' | 'tool_call' | 'error_' | ...;
  status_text?: string;     // 'success' | 'error_max_turns' | etc. (subtype-equivalent)
  cost_usd_delta?: number;
  usage?: WorkerEventUsage;
  payload_json?: string;    // full backend payload as JSON for advanced consumers
  // ...
}

// status_text on the completion event is the closest thing to a structured
// cause. Watch for it.`,
    },
    {
      kind: "code-block",
      title: "Strategy: defensive resets before the wall",
      language: "tsx",
      code: `// Without context_management.edits we can't trigger compaction on a token
// threshold. Next-best: reset the session before context grows past a turn
// budget we've measured for our workload.

const MAX_TURNS_BEFORE_RESET = 8;
const MAX_COST_BEFORE_RESET  = 0.50; // USD

function useResettingAssistant(cwd: string, model: string) {
  const [epoch, setEpoch] = useState(0);
  const { events, ask, close } = useAssistant({
    backend: 'claude_code',
    cwd, model,
    sessionId: \`epoch-\${epoch}\`,
  });

  const numTurns     = events.filter(e => e.kind === 'completion').length;
  const totalCostUsd = events.reduce((s, e) => s + (e.cost_usd_delta ?? 0), 0);

  useEffect(() => {
    if (numTurns >= MAX_TURNS_BEFORE_RESET || totalCostUsd >= MAX_COST_BEFORE_RESET) {
      askForSessionSummary(ask, events).then(() => setEpoch(n => n + 1));
    }
  }, [numTurns, totalCostUsd]);

  return { events, ask, close };
}`,
    },
    {
      kind: "paragraph",
      text:
        "The numbers are workload-specific. Run a few sessions with MAX_TURNS_BEFORE_RESET=999 and watch when an error_ event first appears. Set the threshold to ~70% of that.",
    },
    {
      kind: "code-block",
      title: "Strategy: cart-driven compaction at boundaries",
      language: "typescript",
      code: `// Before resetting, ask Claude to compress the session into notes.md.
// This is the only "compaction" our stack supports today — Claude does it
// explicitly via Edit/Write at our request, OUTSIDE the Messages API.

async function askForSessionSummary(ask: (s: string) => boolean, events: WorkerEvent[]) {
  const prompt = \`Before we wrap this session, write a compact summary into ./notes.md under a new dated heading.

Include:
- Key decisions and conclusions reached this session.
- Facts learned that we'll need next time (numbers, names, dates).
- Open threads that should be picked up later.

Be concise. Skip verbose tool outputs. Reply 'done' when the file is updated.\`;
  ask(prompt);
  // Caller awaits the next 'completion' event before bumping the epoch.
}`,
    },
    {
      kind: "code-block",
      title: "Reload summary as the prefix of the next session",
      language: "tsx",
      code: `import { readFile } from './host';

// On worker respawn (epoch bump), the FIRST ask() of the new session
// prepends prior notes.md content. Read once when the new worker is ready.

const { events, ask, ready } = useAssistant({ backend: 'claude_code', cwd, model, sessionId: \`epoch-\${epoch}\` });

useEffect(() => {
  if (!ready() || epoch === 0) return;
  readFile(\`\${cwd}/notes.md\`, 'utf8')
    .catch(() => '')
    .then(summary => {
      const prompt = summary
        ? \`Prior session notes:\\n\${summary}\\n\\nUser: \${pendingUserMsg}\`
        : pendingUserMsg;
      ask(prompt);
    });
}, [ready(), epoch]);

// You're paying the prefill cost of the summary every fresh session. Still
// cheaper than carrying the entire prior transcript.`,
    },
    {
      kind: "code-block",
      title: "Strategy: aggressive cart-side trimming",
      language: "typescript",
      code: `interface CartTurn {
  role: 'user' | 'assistant';
  text: string;
  toolOutputs: Array<{ name: string; output: string }>;
}

function trimForSend(history: CartTurn[], keepRecent = 3, headBudget = 600): string {
  const recent = history.slice(-keepRecent);
  const lines: string[] = [];
  for (const t of recent) {
    lines.push(\`[\${t.role}] \${t.text}\`);
    for (const tool of t.toolOutputs) {
      const head = tool.output.slice(0, headBudget);
      const truncated = tool.output.length > headBudget ? '… [truncated]' : '';
      lines.push(\`  [tool \${tool.name}] \${head}\${truncated}\`);
    }
  }
  return lines.join('\\n');
}

// Three knobs: keepRecent (how many recent turns), headBudget (how much of
// each tool output survives), and your own threshold for re-sending history
// at all.`,
    },
    {
      kind: "bullet-list",
      title: "Decision rubric on a 200K window",
      items: [
        "Skip cart-driven compaction for single-question / single-answer workloads — let each session live and die on one turn, reset every time.",
        "Skip the notes file for sessions that must remain isolated (compliance, eval, sandboxing). Use a per-session tempdir.",
        "Always trim history before ask(). The cost-per-turn cliff hits hard near the limit.",
      ],
    },
    {
      kind: "code-block",
      title: "Strategy comparison",
      language: "text",
      code: `Strategy                          Lever                              Cost                       Best for
────────────────────────────────  ─────────────────────────────────  ─────────────────────────  ────────────────────────────
Cart-side reset                   bump sessionId / remount           re-init latency (~tens ms) bounded-budget runs
Cart-side summary into notes.md   ask("summarize and stop")          one extra Claude turn      research that must continue
User-message trimming             cart-side string slicing           free                       every workload, always
Server-side compaction            (not exposed)                      —                          out of scope until plumbed
Server-side tool-result clearing  (not exposed)                      —                          out of scope until plumbed`,
    },
    {
      kind: "code-block",
      title: "Telemetry we have vs. what we want",
      language: "text",
      code: `Telemetry                       Available  Source
──────────────────────────────  ─────────  ──────────────────────────────────────
numTurns                        yes        events.filter(e => e.kind === 'completion').length
totalCostUsd                    yes        events.reduce((s,e) => s + (e.cost_usd_delta ?? 0), 0)
duration_ms                     partial    derive from event created_at_ms range
input_tokens / output_tokens    partial    e.usage on completion / usage events (backend-dependent)
cache_read_input_tokens         partial    e.usage.cache_read_input_tokens (Claude SDK doesn't fill it yet)
cache_creation_input_tokens     partial    same — wire through worker_contract.zig
applied_edits (compaction)      no         server-side, hidden
cleared_input_tokens            no         server-side, hidden`,
    },
    {
      kind: "bullet-list",
      title: "Caveats and TODOs against the worker bindings",
      items: [
        "No betas plumbing. framework/assistant/claude_sdk/argv.zig doesn't pass --beta flags. Mid-session compaction (compact_20260112) and clearing (clear_tool_uses_20250919) live on client.beta.messages.create.",
        "No slash-command path. The Claude worker's send fn passes raw user text. Routing a leading '/' through Claude Code's slash-command surface gives us cart-driven /clear and /compact.",
        "Token usage gaps. cache_read_input_tokens / cache_creation_input_tokens fields exist on WorkerEventUsage but the Claude SDK doesn't populate them yet — wire them through framework/assistant/claude_sdk/parser.zig.",
        "status_text enum drift. The string is not enumerated end-to-end. Capture values as you see them and add typed handling for error_max_turns, error_during_execution, etc.",
      ],
    },
    {
      kind: "bullet-list",
      title: "Pattern summary",
      items: [
        "Pick a turn / cost budget below your observed wall.",
        "On each completion event, decide: continue, reset, or summarize-and-reset.",
        "Summarize via ask()-driven Edit on notes.md; reload it as the prefix of the next session's first ask().",
        "Trim cart-side history aggressively before sending — there's no server-side eviction to fall back on.",
        "Treat Claude Code's own auto-compaction as opaque; instrument resets, not edits.",
      ],
    },
    {
      kind: "paragraph",
      title: "Conclusion",
      text:
        "The 200K window doesn't change the strategies, only the urgency. Same levers as Part 1, applied earlier and more often.",
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — same shape as Part 1 with tighter thresholds.\n` +
      `  // A partial scaffold once session-lifecycle + tokens state lands:\n` +
      `  //   useIFTTT(() => state.session.tokens > 160_000, 'reset-session');\n` +
      `  // Needs the same prerequisites as context-management-for-long-running.\n`,
  },
};
