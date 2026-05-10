Giving Claude a Crop Tool for Better Image Analysis

When Claude analyzes images, it sees the entire image at once. For detailed tasks — reading small text, comparing similar values in a chart, examining fine details — that's limiting.

The fix: let Claude "zoom in" by cropping regions of interest. In our stack we don't define a custom `crop_image` tool over MCP. We drive Claude Code as a subprocess (via `useAssistant({ backend: 'claude_code' })`) and lean on the built-in `Read` + `Bash` tools. Claude reads the source image, shells out to `python3` + PIL (or `convert`) to write a cropped PNG, then reads that file.

## When is a crop tool useful?

- Charts and graphs: comparing bars/lines that are close in value, reading axis labels.
- Documents: reading small text, examining signatures or stamps.
- Technical diagrams: tracing wires, reading component labels.
- Dense images: any image where details are small relative to the whole.

## Architecture (this repo)

```text
.tsx cart  ── useAssistant ──>  framework/assistant/worker_bindings.zig
                                  │
                                  └─ framework/assistant/claude_sdk/Session
                                        └─ subprocess: `claude --input-format stream-json`
```

The cart speaks to one hook (`useAssistant`); the hook owns one worker per mount and converts each stream-json message into a normalized `WorkerEvent` you read off the events array.

## The hook surface

`runtime/hooks/useAssistant.ts` exposes:

```typescript
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

const {
  events,    // append-only WorkerEvent[] timeline; reactive
  ask,       // (text: string) => boolean — queue a user turn
  phase,     // 'init' | 'starting' | 'idle' | 'streaming' | 'failed' | 'closed'
  ready,     // () => boolean — true once worker has spawned
  close,     // () => void — manual teardown; the hook also tears down on unmount
  workerId,  // backend-assigned worker id (debug-only)
  error,     // last error string, if any
} = useAssistant({ backend: 'claude_code', cwd, model });
```

Hardcoded defaults inside the Claude branch of the worker today:

- `permission_mode = bypass_permissions` — no prompts, all tools auto-approved.
- `verbose = true`, `inherit_stderr = true`.
- `allowed_tools` is **not** plumbed through yet. The session inherits Claude Code's default tool set (Read, Bash, Edit, Glob, Grep, etc.). For now you sandbox by choice of `cwd`, not by tool whitelisting.

## WorkerEvent shape (relevant kinds)

```typescript
// from runtime/hooks/useAssistant.ts
interface WorkerEvent {
  id: number;
  worker_id: string;
  session_id: string;
  backend: 'claude_code' | 'codex_app_server' | 'kimi_cli_wire' | 'local_ai' | 'openai_compat';
  kind:
    | 'assistant_message'   // text chunks from the model
    | 'reasoning'           // thinking/scratch text
    | 'tool_call'           // model invoked a tool — payload_json carries name+args
    | 'tool_output'         // tool returned — payload_json carries result
    | 'usage' | 'completion' | 'error_'
    | 'lifecycle' | 'context_switch' | 'status' | 'user_message' | 'raw';
  text?: string;
  payload_json?: string;    // backend-shaped JSON for tool_call / raw events
  cost_usd_delta?: number;
  usage?: { input_tokens; output_tokens; cache_creation_input_tokens; cache_read_input_tokens };
}
```

`payload_json` on a `tool_call` event holds something like:

```json
{ "name": "Read", "input": "{\"file_path\":\"chart.png\"}", "id": "..." }
```

`JSON.parse` it before destructuring. Note that `input` may itself be a JSON string and need a second parse.

## Stage the chart on disk

Claude needs a file path it can `Read`. Use `runtime/host` writeFile (or your local equivalent) to drop the source PNG into a workspace directory; then mount the hook with that directory as `cwd`:

```typescript
import { writeFile } from './host';

async function stageImage(workspace: string, pngBytes: Uint8Array): Promise<string> {
  const path = `${workspace}/chart.png`;
  await writeFile(path, pngBytes);
  return path;
}
```

## Build the prompt

Coordinate convention is prompt-side, not tool-side — there's no schema to validate. Spell it out clearly:

```typescript
function buildPrompt(question: string): string {
  return `Answer the following question about ./chart.png.

Question: ${question}

How to inspect the image:
1. First, use Read on ./chart.png so you can see it.
2. If you need a closer look at a region, use Bash to write a cropped PNG, then Read the crop.

Crop with python3 + PIL. Use normalized 0-1 coordinates so you don't have to know the source dims:

  python3 - <<'PY'
  from PIL import Image
  im = Image.open("chart.png")
  w, h = im.size
  x1, y1, x2, y2 = 0.0, 0.0, 0.4, 0.35   # legend region, top-left
  im.crop((int(x1*w), int(y1*h), int(x2*w), int(y2*h))).save("crop.png")
  PY

Then Read ./crop.png. Overwrite crop.png each time you zoom into a new region.

When you have an answer, state it clearly with a one-line conclusion.`;
}
```

Three things this prompt does:

1. Tells Claude where the image is.
2. Hands over the exact crop one-liner so it doesn't burn turns inventing PIL syntax.
3. Sets a normalized coordinate convention without any schema enforcement.

## Reduce the events stream into a turn

The hook owns the worker, so all you do cart-side is read `events` and fold them into the shape your UI wants:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Text } from '@reactjit/runtime/primitives';
import { useAssistant, WorkerEvent } from '@reactjit/runtime/hooks/useAssistant';

interface Turn {
  text: string;
  thinking: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  done: boolean;
  cost: number;
}

function reduceTurn(events: WorkerEvent[]): Turn {
  let text = '', thinking = '';
  const toolCalls: Turn['toolCalls'] = [];
  let done = false, cost = 0;
  for (const ev of events) {
    if (ev.kind === 'assistant_message' && ev.text) text += ev.text;
    else if (ev.kind === 'reasoning' && ev.text)    thinking += ev.text;
    else if (ev.kind === 'tool_call' && ev.payload_json) {
      try {
        const parsed = JSON.parse(ev.payload_json);
        let input: unknown = parsed?.input;
        if (typeof input === 'string') { try { input = JSON.parse(input); } catch {} }
        toolCalls.push({ name: parsed?.name ?? '?', input });
      } catch {}
    }
    else if (ev.kind === 'completion') {
      done = true;
      cost += ev.cost_usd_delta ?? 0;
    }
  }
  return { text, thinking, toolCalls, done, cost };
}

export default function CropDemo({ workspace, chartPng, question }: {
  workspace: string; chartPng: Uint8Array; question: string;
}) {
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stageImage(workspace, chartPng).then(() => setStaged(true)).catch(e => setError(String(e)));
  }, []);

  const { events, ask, ready } = useAssistant({
    backend: 'claude_code',
    cwd: workspace,
    model: 'claude-opus-4-7',
  });

  useEffect(() => {
    if (!staged || !ready()) return;
    ask(buildPrompt(question));
  }, [staged, ready()]);

  const turn = useMemo(() => reduceTurn(events), [events]);

  return (
    <Col className="p-4 gap-3">
      <Text className="font-semibold">Q: {question}</Text>
      {error && <Text className="text-red-400">{error}</Text>}
      {turn.toolCalls.map((t, i) => (
        <Box key={i} className="px-2 py-1 bg-zinc-900 rounded">
          <Text className="text-xs text-cyan-300">[{t.name}] {JSON.stringify(t.input)}</Text>
        </Box>
      ))}
      <Text>{turn.text}</Text>
      {turn.done && <Text className="text-xs text-zinc-500">${turn.cost.toFixed(4)}</Text>}
    </Col>
  );
}
```

The hook handles spawn, polling, and teardown — there's no `setInterval`, no manual `__claude_poll` loop. Events arrive in `events` as the worker reports them.

## Demo: chart analysis

Feed it a FigureQA-style question against a stored chart:

```text
Q: Is Cyan the minimum?

[Read] {"file_path":"chart.png"}
[Bash] {"command":"python3 - <<'PY'\nfrom PIL import Image\nim=Image.open('chart.png')\nw,h=im.size\nx1,y1,x2,y2=0.4,0.6,0.7,0.9\nim.crop((int(x1*w),int(y1*h),int(x2*w),int(y2*h))).save('crop.png')\nPY"}
[Read] {"file_path":"crop.png"}

Yes — Cyan is the smallest slice in the pie chart, well under the next-smallest Light Slate.

$0.0182
```

Each `[name]` line is a `tool_call` event surfaced through the events array. The text body is the joined `assistant_message.text` from successive events.

## Caveats and TODOs

- **One worker per `useAssistant` mount.** That's by design — for parallel sessions, mount two `<CropDemo>` instances. Each gets its own worker, session, and events stream.
- **No `allowed_tools` from the cart.** Today the session inherits the default Claude Code toolset. Sandbox by choosing a cwd you're comfortable with the agent rooting around in. Add an opts field to the Claude branch of `framework/assistant/worker_bindings.zig` when this matters.
- **No `systemPrompt` override from the cart for `claude_code`.** Anything system-prompty has to ride on the user message. (`openai_compat` already accepts `systemPrompt`.)
- **Image input is via filesystem only.** No base64 image content blocks — Claude reads files. Always stage to `cwd` first.
- **`tool_call` payload is backend-shaped.** `payload_json` carries `{ name, input, id }` with `input` often itself a JSON string. `JSON.parse` twice if needed before destructuring.

## Pattern summary

1. Stage the source image to a workspace dir.
2. Mount `useAssistant({ backend: 'claude_code', cwd, model })` — the hook owns the worker.
3. `ask(prompt)` once `ready()` is true, with the question + a "use Read+Bash to crop, then Read the crop" instruction.
4. Reduce the `events` array into your turn shape; `tool_call` events carry the Read/Bash invocations.
5. `close()` / unmount when done; the hook tears the worker down automatically.

This works because Claude can see the full image first, identify regions that need closer inspection, and iteratively zoom in — all using built-ins, no custom tool registration, no MCP.
