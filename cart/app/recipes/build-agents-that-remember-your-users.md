# Build agents that remember your users

Most agents start every conversation from scratch. A customer tells your shopping assistant their size, budget, and which materials they avoid, and the next time they return, the agent has forgotten everything.

The original Anthropic recipe solves this with the **Claude Managed Agents** beta — a cloud-hosted runtime where you create a `memory_store`, attach it to a `session`, and the agent reads/writes through `/mnt/memory/{store}`. We don't have that. `framework/assistant/claude_sdk/` drives the local `claude` CLI through the unified worker contract. The closest analog: **the session's `cwd` is the memory store.** Claude Code already has Read/Edit/Write/Glob, and a directory persists between session inits.

This recipe rebuilds the shopping-assistant pattern around that reality.

## What you'll build

- A per-customer workspace directory that holds preference notes.
- A first-visit turn that captures preferences into `preferences.md`.
- A second-visit turn that re-uses the same directory and recalls them.
- A read-only path for your app code to inspect or seed the file.

## Architecture

```text
.tsx cart  ── useAssistant ──>  framework/assistant/worker_bindings.zig
                                  │
                                  └─ framework/assistant/claude_sdk/Session  (cwd = workspace/<customer-id>/)
                                        └─ subprocess: `claude --input-format stream-json`

workspace/
└── <customer-id>/
    ├── preferences.md       ← Claude reads/edits this
    └── purchase-history.md  ← optionally seeded by your app
```

Every customer gets their own directory. That directory is the memory store.

## Per-customer workspace

```typescript
import { writeFile, mkdir } from './host';

async function workspaceFor(customerId: string): Promise<string> {
  const dir = `${WORKSPACE_ROOT}/${customerId}`;
  await mkdir(dir, { recursive: true });
  return dir;
}
```

Pick a stable id from your app's user model. Don't reuse the same dir across customers — Claude will conflate preferences.

## The memory contract

Pin Claude to one filename and one shape so the file stays useful across visits:

```typescript
export const MEMORY_INSTRUCTION = `You are a personal shopping assistant.

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

Keep entries short and dated when relevant.`;
```

This instruction goes in front of every user turn (no `system_prompt` slot from the cart yet — see TODOs).

## First visit: capture

The `useAssistant` hook owns the worker lifecycle and exposes a normalized event stream. There are no per-backend host fns to wire up — pick a backend, pass it `cwd`, and read events.

```tsx
import { useEffect, useMemo, useState } from 'react';
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
    ask(`${MEMORY_INSTRUCTION}\n\nCustomer: ${userMsg}`);
  }, [ready(), userMsg]);

  // Derive streaming text + completion from the event timeline.
  const text = useMemo(
    () => events.filter(e => e.kind === 'assistant_message').map(e => e.text ?? '').join(''),
    [events],
  );
  const done = phase === 'idle' || phase === 'failed';

  return <Render text={text} done={done} />;
}
```

Run a first turn:

```tsx
<Shopper
  customerId="cust_42"
  userMsg={
    "Hi! I'm looking for a new jacket. I wear a size medium, only buy vegan " +
    "leather (no animal leather please), my budget is usually under $200, and " +
    "I love earth tones. What would you suggest?"
  }
/>
```

Expected behavior:
1. Claude calls `Read({"file_path":"./preferences.md"})` — file doesn't exist yet, gets a not-found. Surfaces as a `tool_call` event in `events`.
2. Claude makes recommendations using the constraints from the user message — `assistant_message` events stream in.
3. Claude calls `Edit` (creating the file via `Write` if Edit fails) to record sizes / materials / budget / style.
4. The hook's `phase` flips to `idle` when the final `completion` event lands.

## Inspect what got stored

```typescript
import { readFile } from './host';

async function dumpMemory(cwd: string) {
  const text = await readFile(`${cwd}/preferences.md`, 'utf8');
  console.log(text);
}
```

Typical output after the first turn:

```markdown
# Sizes
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
- First visit; preferences collected 2026-04-28
```

## Second visit: recall

Mount the same component with the same `customerId` — `useAssistant` spawns a fresh worker against the same `cwd`, and Claude finds the file on its first `Read`.

```tsx
<Shopper
  customerId="cust_42"   // same id → same workspace dir
  userMsg="Hey, I'm back! I need a bag for work. Any recommendations?"
/>
```

This time Claude's first tool call is `Read({"file_path":"./preferences.md"})` and the recommendations are size-medium, vegan, earth-toned, sub-$200 right out of the gate — without the customer repeating themselves.

## Seeding from your app

Anything your CRM already knows about the customer goes straight into the workspace before the first turn:

```typescript
async function seedMemory(cwd: string) {
  await writeFile(`${cwd}/purchase-history.md`, `# Recent purchases
- Canvas tote, olive, $89 (Jan 2026)
- Wool beanie, rust, $34 (Dec 2025)
`);
}
```

Tell Claude about the file in the instruction:

```typescript
const MEMORY_INSTRUCTION_WITH_HISTORY = `${MEMORY_INSTRUCTION}

If ./purchase-history.md exists, Read it for context on past orders. Don't
edit purchase-history.md — it's owned by the application.`;
```

## Mixing per-customer + shared stores

The original recipe layered a per-customer store with a shared catalog store. Same pattern here:

```text
workspace/
├── <customer-id>/preferences.md          ← per-customer, read+write
└── _shared/catalog-notes.md              ← shared across customers, read-only
```

Use the `add_dirs` field in `SessionOptions` to expose `_shared/` to a session whose `cwd` is the customer dir. **Today this isn't plumbed through the worker opts** — see TODOs.

## Caveats and TODOs against the worker bindings

- **No `system_prompt` from the cart for `claude_code`.** Memory instructions ride on every user message. When `framework/assistant/worker_bindings.zig` grows the field for the Claude backend (it's already wired for `openai_compat`), move `MEMORY_INSTRUCTION` there.
- **No `add_dirs` in the worker opts.** Cross-store layering (shared catalog + per-customer prefs) needs `add_dirs` added to the Claude opts schema. Until then, copy the shared file into each customer's cwd at session start.
- **One worker per `useAssistant` mount.** That's by design — for two customers concurrently, mount two `<Shopper>` instances with different `customerId`s. Each gets its own worker, its own session, its own `cwd`.
- **No "memory store" abstraction.** There's no API to list memories, version them, or get a typed view. You're working with files. If you need an audit trail, snapshot the cwd to git after each session.
- **Claude Code default permission_mode is `bypass_permissions`.** Edits to `preferences.md` happen without a prompt. That's fine for a memory file scoped to the customer's own dir, but don't widen the cwd to anything sensitive.

## Pattern summary

1. One directory per customer; pass it as `cwd` to `useAssistant({ backend: 'claude_code', cwd, model })`.
2. Pin Claude to a known filename (`preferences.md`) and a known schema in the prompt.
3. First turn: Claude finds nothing, makes recommendations, writes the file.
4. Second turn: same `cwd`, Claude reads the file first, recommendations land pre-personalized.
5. Seed extra knowledge by writing files into `cwd` before the session starts.
6. Inspect / migrate / export memory by reading those files from your app.

The "memory store" is just a workspace. The persistence layer is `cwd` + the filesystem.
