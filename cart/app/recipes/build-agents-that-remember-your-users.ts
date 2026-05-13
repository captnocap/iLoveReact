import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "build-agents-that-remember-your-users",
  title: "Build agents that remember your users",
  sourcePath: "cart/app/recipes/build-agents-that-remember-your-users.md",
  instructions:
    "Persist customer preferences across sessions by treating the session's cwd as a memory store. Per-customer workspace directory + a pinned notes file (preferences.md) Claude reads at session start and edits when it learns something new. Drives the local claude CLI through useAssistant({ backend: 'claude_code', cwd, model }); the original 'memory_store' beta from Claude Managed Agents has no analog in framework/assistant/claude_sdk/, but cwd + Read/Edit is the closest local equivalent.",
  sections: [
    {
      kind: "paragraph",
      text:
        "Most agents start every conversation from scratch. The original Anthropic recipe solves this with the Claude Managed Agents memory_store beta — cloud-hosted, mounted at /mnt/memory/{store}. We don't have that. framework/assistant/claude_sdk/ drives the local claude CLI through the unified worker contract; the closest analog is the session's cwd. Each customer gets their own directory; Claude reads/edits preferences.md inside it.",
    },
    {
      kind: "bullet-list",
      title: "What you'll build",
      items: [
        "A per-customer workspace directory holding preference notes.",
        "A first-visit turn that captures preferences into preferences.md.",
        "A second-visit turn that re-uses the same directory and recalls them.",
        "A read-only path for your app to inspect or seed the file.",
      ],
    },
    {
      kind: "code-block",
      title: "Architecture",
      language: "text",
      code: `.tsx cart  ── useAssistant ──>  framework/assistant/worker_bindings.zig
                                  │
                                  └─ framework/assistant/claude_sdk/Session  (cwd = workspace/<customer-id>/)
                                        └─ subprocess: \`claude --input-format stream-json\`

workspace/
└── <customer-id>/
    ├── preferences.md       ← Claude reads/edits this
    └── purchase-history.md  ← optionally seeded by your app`,
    },
    {
      kind: "code-block",
      title: "Per-customer workspace",
      language: "typescript",
      code: `import { writeFile, mkdir } from './host';

async function workspaceFor(customerId: string): Promise<string> {
  const dir = \`\${WORKSPACE_ROOT}/\${customerId}\`;
  await mkdir(dir, { recursive: true });
  return dir;
}`,
    },
    {
      kind: "code-block",
      title: "The memory contract — pin Claude to one filename and one schema",
      language: "typescript",
      code: `export const MEMORY_INSTRUCTION = \`You are a personal shopping assistant.

This workspace holds one customer's preferences. Treat it as long-term memory.

At the start of every conversation:
1. Read ./preferences.md if it exists. If not, that's fine.
2. Use whatever you find to tailor recommendations.

Whenever you learn something durable about the customer (size, materials,
brands they like or hate, budget, style words they use), update
./preferences.md with the new fact. Use Edit, not Write — preserve existing
sections.

The file is plain markdown with these sections (create them lazily):

  # Sizes
  # Style
  # Budget
  # Materials to avoid
  # Favorite brands
  # Other notes

Keep entries short and dated when relevant.\`;`,
    },
    {
      kind: "code-block",
      title: "First visit: capture preferences via useAssistant",
      language: "tsx",
      code: `import { useEffect, useMemo, useState } from 'react';
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

export function Shopper({ customerId, userMsg }: { customerId: string; userMsg: string }) {
  const [cwd, setCwd] = useState<string | null>(null);
  useEffect(() => { workspaceFor(customerId).then(setCwd); }, [customerId]);

  const { events, ask, phase, ready } = useAssistant({
    backend: 'claude_code',
    cwd: cwd ?? undefined,
    model: 'claude-sonnet-4-6',
  });

  // Send the turn once the worker is ready and we have the user's message.
  useEffect(() => {
    if (!ready() || !userMsg) return;
    ask(\`\${MEMORY_INSTRUCTION}\\n\\nCustomer: \${userMsg}\`);
  }, [ready(), userMsg]);

  // Derive streaming text + completion from the event timeline.
  const text = useMemo(
    () => events.filter(e => e.kind === 'assistant_message').map(e => e.text ?? '').join(''),
    [events],
  );
  const done = phase === 'idle' || phase === 'failed';

  return <Render text={text} done={done} />;
}`,
    },
    {
      kind: "code-block",
      title: "Run a first turn",
      language: "tsx",
      code: `<Shopper
  customerId="cust_42"
  userMsg={
    "Hi! I'm looking for a new jacket. I wear a size medium, only buy vegan " +
    "leather (no animal leather please), my budget is usually under $200, and " +
    "I love earth tones. What would you suggest?"
  }
/>`,
    },
    {
      kind: "bullet-list",
      title: "Expected behavior",
      items: [
        "Claude calls Read({\"file_path\":\"./preferences.md\"}) — file doesn't exist yet, gets a not-found. Surfaces as a tool_call event in `events`.",
        "Claude makes recommendations using the constraints from the user message — assistant_message events stream in.",
        "Claude calls Edit (or Write to create) to record sizes, materials, budget, style.",
        "The hook's `phase` flips to 'idle' when the final completion event lands.",
      ],
    },
    {
      kind: "code-block",
      title: "Inspect what got stored",
      language: "typescript",
      code: `import { readFile } from './host';

async function dumpMemory(cwd: string) {
  const text = await readFile(\`\${cwd}/preferences.md\`, 'utf8');
  console.log(text);
}`,
    },
    {
      kind: "code-block",
      title: "Typical preferences.md after the first turn",
      language: "markdown",
      code: `# Sizes
- Tops/Jackets: Medium

# Style
- Earth tones (browns, tans, olive, terracotta, camel, rust)
- Looking for: jacket

# Budget
- Usually under $200

# Materials to avoid
- Animal leather (vegan leather only)

# Favorite brands
- (none yet)

# Other notes
- First visit; preferences collected 2026-04-28`,
    },
    {
      kind: "code-block",
      title: "Second visit: same customerId, automatic recall",
      language: "tsx",
      code: `<Shopper
  customerId="cust_42"   // same id → same workspace dir
  userMsg="Hey, I'm back! I need a bag for work. Any recommendations?"
/>`,
    },
    {
      kind: "paragraph",
      text:
        "Claude's first tool call is Read({\"file_path\":\"./preferences.md\"}); recommendations land size-medium, vegan, earth-toned, sub-$200 without the customer repeating themselves.",
    },
    {
      kind: "code-block",
      title: "Seeding from your app's CRM",
      language: "typescript",
      code: `async function seedMemory(cwd: string) {
  await writeFile(\`\${cwd}/purchase-history.md\`, \`# Recent purchases
- Canvas tote, olive, $89 (Jan 2026)
- Wool beanie, rust, $34 (Dec 2025)
\`);
}

const MEMORY_INSTRUCTION_WITH_HISTORY = \`\${MEMORY_INSTRUCTION}

If ./purchase-history.md exists, Read it for context on past orders. Don't
edit purchase-history.md — it's owned by the application.\`;`,
    },
    {
      kind: "code-block",
      title: "Mixing per-customer + shared stores (deferred)",
      language: "text",
      code: `workspace/
├── <customer-id>/preferences.md          ← per-customer, read+write
└── _shared/catalog-notes.md              ← shared across customers, read-only

# Layering needs add_dirs added to the worker opts schema (currently absent).
# Workaround until then: copy the shared file into each customer's cwd at session start.`,
    },
    {
      kind: "bullet-list",
      title: "Caveats and TODOs against the worker bindings",
      items: [
        "No system_prompt for claude_code in the worker opts. Memory instruction rides on every user message; move to the system slot when framework/assistant/worker_bindings.zig grows the field for Claude (it's already wired for openai_compat).",
        "No add_dirs in the worker opts. Cross-store layering (shared catalog + per-customer) needs add_dirs added to the Claude opts schema; copy files into cwd as a workaround.",
        "One worker per useAssistant mount — by design. For two customers concurrently, mount two <Shopper> instances with different customerIds; each gets its own worker, session, and cwd.",
        "No 'memory store' abstraction. No API to list/version/audit memories — you have files. Snapshot cwd to git after each session if you need an audit trail.",
        "Claude Code default permission_mode is bypass_permissions. Edits to preferences.md happen without prompt — fine inside the customer dir, do not widen cwd.",
      ],
    },
    {
      kind: "bullet-list",
      title: "Pattern summary",
      items: [
        "One directory per customer; pass it as cwd to useAssistant({ backend: 'claude_code', cwd, model }).",
        "Pin Claude to a known filename (preferences.md) and a known schema in the prompt.",
        "First turn: Claude finds nothing, makes recommendations, writes the file.",
        "Second turn: same cwd, Claude reads first, recommendations land pre-personalized.",
        "Seed extra knowledge by writing files into cwd before the session starts.",
        "Inspect / migrate / export by reading those files from your app.",
      ],
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — this recipe is an agent-with-memory pattern,\n` +
      `  // not a 2-node useIFTTT chain. Substrate gap: no first-class\n` +
      `  // assistant:profile-update event; profile reads/writes live in cart\n` +
      `  // code rather than as IFTTT rules. Likely needs composition-shaped\n` +
      `  // recipes or a memory-event source registered on the bus.\n`,
  },
};
