# A local Gemma TRUE/FALSE gate for Claude edits over stale line manifests

When a long-running agent edits a file from a manifest ("on line 22, change X
to Y"), the manifest itself drifts — someone added an import, the function
slid down four lines, and now the agent is being asked to edit the wrong
location. Big models tend to *cope* with stale manifests: they squint at the
file, find what looks like the right thing nearby, and patch *that*. The bug
that ships is a confidently-wrong edit on a line the user never named.

This recipe is a two-round benchmark for that failure mode. Round 1 hands
Claude a file and a manifest with a soft, non-leading prompt and watches what
it does on its own. Round 2 puts a tiny local Gemma model in front of Claude
as a *line-number gate* — it ships the full file with line numbers, asks one
TRUE/FALSE question per claim, and prepends the verdicts as a preamble before
Claude is allowed to write anything. Claude's job in round 2 is no longer
"figure out what's wrong"; it's "act on a verdict you didn't author".

Gemma runs through this repo's own llama runtime — `framework/assistant/llama_exports.zig`
keeps the `libllama_ffi.so` symbols alive against the linker, and
`framework/assistant/local_ai_runtime.zig` consumes them as a `Session` API.
Both Claude and Gemma are reached through the same `useAssistant` hook —
different `backend` values pick the underlying worker. No HTTP server, no LM
Studio, no extra process. The gate is one hook mount.

## What you'll build

- `target.py` — a 56-line order-book engine. The actual file.
- `manifest.md` — fourteen line-number claims that *used* to be true, but
  every claim is shifted by ~13 lines because someone added an `Order`
  dataclass after the manifest was written. Almost every claim is now FALSE
  by exact-line standard.
- Round 1: a `useAssistant({ backend: 'claude_code' })` cart with a soft
  prompt — *"glance at this and tell me what you think."* No mention of line
  numbers, no hint that the manifest is stale.
- Round 2: a TSX cart that mounts `useAssistant({ backend: 'local_ai',
  modelPath })` to load Gemma-4-E2B (Q8) into VRAM via the framework's llama
  runtime, walks the manifest, and emits a TRUE/FALSE preamble. The preamble
  is then concatenated with the same prompt and sent through a Claude
  `useAssistant`.

## Architecture

```
.tsx cart
  ├── useAssistant({ backend: 'local_ai', modelPath, nCtx, maxTokens })   ← runtime/hooks/useAssistant.ts
  │     ├── framework/assistant/worker_bindings.zig         (V8 host fns __worker_*)
  │     ├── framework/assistant/local_ai_runtime.zig        (async Session, llama batches)
  │     └── framework/assistant/llama_exports.zig           (link-keepalive shim)
  └── useAssistant({ backend: 'claude_code', cwd, model })  ← same hook, different backend
        └── framework/assistant/claude_sdk/Session

corpus on disk:
experiments/manifest_check/target.py
experiments/manifest_check/manifest.md
```

The same `local_ai_runtime.zig` that powers `useEmbed`'s reranker drives
generation here — it's already a `Session` with submit/poll. We just open it
with a chat model instead of an embedding model, behind
`useAssistant({ backend: 'local_ai' })`.

## Round 1 — the soft prompt

The prompt deliberately gives nothing away. No "check the line numbers", no
"this manifest may be stale", no scoring rubric. Just two attached blobs and
a request to *look at it*. This is the prompt-shape that produces wrong
edits in the wild — a tired teammate dropping a file in chat at 4 PM.

```tsx
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

function Round1({ manifestText, fileText }: { manifestText: string; fileText: string }) {
  const { events, ask, ready } = useAssistant({
    backend: 'claude_code',
    model: 'claude-opus-4-7',
  });

  useEffect(() => {
    if (!ready()) return;
    ask(
      "i've got a manifest a teammate wrote that's supposed to describe a small python\n" +
      "file — order book engine. i want a second pair of eyes. take a quick look and\n" +
      "tell me what you think of it. nothing specific to check, just glance over it.\n\n" +
      `----- manifest.md -----\n${manifestText}\n----- target.py -----\n${fileText}`
    );
  }, [ready()]);

  return <RenderEvents events={events} />;
}
```

What we see: Claude reads both, recognizes the code, often *paraphrases* the
manifest as if it were correct, sometimes flags one or two off-by-N lines as
"close" but rarely returns a verdict per claim. The failure is not that
Claude is dumb — it's that the prompt didn't ask, so Claude didn't answer.
The fix lives in the *next* round, not in a longer prompt.

## Round 2 — the local Gemma gate

Mount one `useAssistant` against the local Gemma model, then drive the
manifest one claim at a time off the events stream. Each request ships the
*full* file with line numbers prefixed and asks exactly one question: does
line N say what the manifest says it says? The sampler is forced to one of
two tokens.

```tsx
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

const MODEL =
  '/home/you/.lmstudio/models/HauhauCS/Gemma-4-E2B-Uncensored-HauhauCS-Aggressive/' +
  'Gemma-4-E2B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf';

function ManifestGate({ file, claims }: { file: string; claims: { line: number; claim: string }[] }) {
  const { events, ask, ready } = useAssistant({
    backend: 'local_ai',
    modelPath: MODEL,
    nCtx: 262144,    // Gemma-4 supports >200k natively; no chunking, full file every call
    maxTokens: 4,
    systemPrompt:
      'You are a strict line-checker. Reply with exactly one word: ' +
      'TRUE or FALSE. No punctuation, no explanation.',
  });

  const numbered = useMemo(
    () => file.split('\n').map((ln, i) => `${String(i + 1).padStart(4)}: ${ln}`).join('\n'),
    [file],
  );

  // Drive one claim at a time: send next when the prior turn completed.
  const [idx, setIdx] = useState(0);
  const verdicts = useMemo(
    () => extractVerdictsFromEvents(events),  // pulls one TRUE/FALSE per completion event
    [events],
  );

  useEffect(() => {
    if (!ready() || idx >= claims.length) return;
    if (verdicts.length !== idx) return;       // wait for prior verdict to land
    const c = claims[idx];
    ask(
      `FILE (line-numbered):\n\`\`\`\n${numbered}\n\`\`\`\n\n` +
      `CLAIM: line ${c.line} of the file matches:\n  "${c.claim}"\n\n` +
      `Look at line ${c.line} EXACTLY (not nearby lines). ` +
      `Does the actual content of that exact line match the claim?\n` +
      `Answer with one word: TRUE or FALSE.`,
    );
    setIdx(n => n + 1);
  }, [ready(), idx, verdicts.length]);

  return verdicts.map((v, i) => ({ line: claims[i].line, verdict: v, claim: claims[i].claim }));
}
```

Two details that matter:

- **One claim per `ask()`, not one batched call.** Stuffing all fourteen
  claims into one prompt collapses Gemma's accuracy — it starts hedging.
  One claim in, one token out, repeat.
- **`maxTokens: 4`** in the opts. The sampler has no room to be creative,
  and the constrained shape makes parsing trivial: anything that doesn't
  start with TRUE or FALSE is treated as `UNCLEAR` and re-asked once with
  the line content quoted back at it.

Gemma-4's context window is >200k tokens. Set `nCtx: 262144` and forget
about chunking entirely — even a 10k-line file fits in one prompt with room
left over for every claim's preamble, the tokenized line-number prefix, and
a system message. The KV cache only fills the part of the window you
actually use, so the cost is the file's *real* token count, not the
configured ceiling. Practically: you can keep the same warm worker across
files, prepend a directory of source on first use, and let the gate answer
claims about *any* line in *any* file the cart has shown it without
reloading.

## Wiring the verdicts into Claude's prompt

The preamble is plain text, prepended to the same payload Round 1 saw. The
shape is deliberate — Claude is told *up front* which claims are stale, so
it stops trying to decide and starts trying to act:

```
=== GEMMA LINE-NUMBER GATE PREAMBLE ===
verdicts: 1 TRUE, 13 FALSE, 0 unclear (total 14)

per-claim verdict (line N of target.py vs manifest claim):
  [TRUE]  line 1: Module docstring describing the order-book engine.
  [FALSE] line 3: `import heapq` — heap primitives for the order book.
  [FALSE] line 5: `class Book:` — the order-book class is declared here.
  ...
=== END PREAMBLE ===
```

In testing, Claude's behaviour with the preamble is qualitatively different:
it stops paraphrasing the manifest, asks (or assumes) that the manifest is
the artifact in need of repair rather than the file, and produces an updated
manifest with corrected line numbers in one pass. With Round 1's prompt
alone it produced a description-of-the-file that quietly inherited the
manifest's mistakes.

## Why this works on a 2B model

Gemma-4-E2B is 2.6B parameters, fits in <3 GB at Q8, and runs at ~80 tok/s
on a 7900 XTX through this repo's llama runtime. It would *fail* at "review
this code" — but it succeeds at the much narrower task of "is the string at
position N in this list of strings the same as this other string?". That's
the entire job. We pay one cheap, deterministic forward pass per claim and
get a structured signal Claude can act on without re-deriving it.

The general shape — *small fast local model gates a big slow remote model
with a constrained T/F preamble* — is the move. Line-number drift is just
the test case; the same pattern applies to "did this regex match exactly
zero things?", "is this file longer than it was?", "does this JSON parse?".
Anything where a verifier is cheaper than a generator.

## Going further

- **Self-healing manifest.** When the gate returns mostly FALSE, have
  Claude emit a corrected manifest as its first output and re-run round 2
  against the new one. If the second pass is mostly TRUE, ship the
  rewritten manifest as a side-effect of the original task.
- **Streaming gate.** The `useAssistant` events stream emits
  `assistant_message` chunks as the model decodes — for very large files you
  can render preliminary verdicts and start prompting Claude before the gate
  finishes.
- **Wider models.** Swap the Gemma `modelPath` for a
  `Qwen3.6-27B-Q4_K_M.gguf` — same hook, different opts: ~10× slower,
  marginal accuracy gain. Worth it only when claims aren't pure substring
  checks.
- **Other claim shapes.** `useAssistant` doesn't know about line numbers.
  Swap the prompt for "is `foo` defined in this file?" or "does this
  function have early returns?" and the same TRUE/FALSE preamble works.
