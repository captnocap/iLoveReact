import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "giving-claude-a-crop-tool-for-better-image-analysis",
  title: "Giving Claude a Crop Tool for Better Image Analysis",
  sourcePath:
    "cart/app/recipes/giving-claude-a-crop-tool-for-better-image-analysis.md",
  instructions:
    "Let Claude zoom into images by mounting useAssistant({ backend: 'claude_code', cwd, model }): stage the image to a workspace dir, send a prompt that instructs Read+Bash crops via PIL, and read the assistant_message / tool_call events from the hook's events array.",
  sections: [
    {
      kind: "paragraph",
      text:
        "Claude sees the entire image at once. For tasks that need fine detail — close bar values, small text, dense diagrams — that's limiting. In our stack we don't define a custom crop_image tool over MCP; we drive Claude Code as a subprocess (via useAssistant({ backend: 'claude_code' })) and lean on built-in Read + Bash. Claude reads the source PNG, shells out to python3+PIL (or ImageMagick) to write a cropped file, then reads that file.",
    },
    {
      kind: "bullet-list",
      title: "When a crop tool helps",
      items: [
        "Charts and graphs: comparing close values, reading axis labels and legends.",
        "Documents: reading small text, examining signatures or stamps.",
        "Technical diagrams: tracing wires, reading component labels.",
        "Dense images: any frame where details are small relative to the whole.",
      ],
    },
    {
      kind: "code-block",
      title: "Architecture in this repo",
      language: "text",
      code: `.tsx cart  ── useAssistant ──>  framework/assistant/worker_bindings.zig
                                  │
                                  └─ framework/assistant/claude_sdk/Session
                                        └─ subprocess: \`claude --input-format stream-json\``,
    },
    {
      kind: "code-block",
      title: "The hook surface",
      language: "typescript",
      code: `import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

// One mount = one worker = one session. Returns:
const {
  events,      // append-only WorkerEvent[] timeline; reactive
  ask,         // (text: string) => boolean — queue a user turn
  phase,       // 'init' | 'starting' | 'idle' | 'streaming' | 'failed' | 'closed'
  ready,       // () => boolean — true once worker has spawned
  close,       // () => void — manual teardown; the hook also tears down on unmount
  workerId,    // backend-assigned worker id (debug-only)
  error,       // last error string, if any
} = useAssistant({ backend: 'claude_code', cwd, model });`,
    },
    {
      kind: "bullet-list",
      title: "What the Claude worker hardcodes today",
      items: [
        "permission_mode = bypass_permissions — no prompts, all tools auto-approved.",
        "verbose = true, inherit_stderr = true.",
        "allowed_tools is NOT plumbed through yet — the session inherits Claude Code's default toolset (Read, Bash, Edit, Glob, Grep, ...). Sandbox by choice of cwd.",
        "No systemPrompt override from the cart for claude_code. Anything system-prompty rides on the user message.",
      ],
    },
    {
      kind: "code-block",
      title: "WorkerEvent shape (relevant kinds)",
      language: "typescript",
      code: `// from runtime/hooks/useAssistant.ts
interface WorkerEvent {
  id: number;
  worker_id: string;
  session_id: string;
  backend: 'claude_code' | 'codex_app_server' | 'kimi_cli_wire' | 'local_ai' | 'openai_compat';
  kind:
    | 'assistant_message'   // text chunks from the model
    | 'reasoning'           // thinking/scratch text (subset of backends)
    | 'tool_call'           // model invoked a tool — payload_json carries name+args
    | 'tool_output'         // tool returned — payload_json carries result
    | 'usage' | 'completion' | 'error_'
    | 'lifecycle' | 'context_switch' | 'status' | 'user_message' | 'raw';
  text?: string;
  payload_json?: string;    // backend-shaped JSON for tool_call / raw events
  cost_usd_delta?: number;
  usage?: { input_tokens; output_tokens; cache_creation_input_tokens; cache_read_input_tokens };
  // ...
}

// payload_json on a tool_call event holds something like
//   { "name": "Read", "input": "{\\"file_path\\":\\"chart.png\\"}", "id": "..." }
// JSON.parse it before destructuring.`,
    },
    {
      kind: "code-block",
      title: "Stage the chart to disk so Claude can Read it",
      language: "typescript",
      code: `import { writeFile } from './host';

async function stageImage(workspace: string, pngBytes: Uint8Array): Promise<string> {
  const path = \`\${workspace}/chart.png\`;
  await writeFile(path, pngBytes);
  return path;
}`,
    },
    {
      kind: "code-block",
      title: "Build the prompt — coordinate convention lives here",
      language: "typescript",
      code: `function buildPrompt(question: string): string {
  return \`Answer the following question about ./chart.png.

Question: \${question}

How to inspect the image:
1. First, use Read on ./chart.png so you can see it.
2. If you need a closer look at a region, use Bash to write a cropped PNG, then Read the crop.

Crop with python3 + PIL using normalized 0-1 coordinates:

  python3 - <<'PY'
  from PIL import Image
  im = Image.open("chart.png")
  w, h = im.size
  x1, y1, x2, y2 = 0.0, 0.0, 0.4, 0.35   # legend region, top-left
  im.crop((int(x1*w), int(y1*h), int(x2*w), int(y2*h))).save("crop.png")
  PY

Then Read ./crop.png. Overwrite crop.png each time you zoom into a new region.

When you have an answer, state it clearly with a one-line conclusion.\`;
}`,
    },
    {
      kind: "bullet-list",
      title: "Why this prompt shape",
      items: [
        "Tells Claude exactly where the image is on disk.",
        "Hands over the PIL one-liner so it doesn't burn turns inventing crop syntax.",
        "Establishes the normalized 0-1 coordinate convention without any schema.",
        "Asks for a one-line conclusion so the cart UI has something definitive to render.",
      ],
    },
    {
      kind: "code-block",
      title: "Cart component: derive the running turn from events",
      language: "tsx",
      code: `import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
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
      {turn.done && <Text className="text-xs text-zinc-500">\${turn.cost.toFixed(4)}</Text>}
    </Col>
  );
}`,
    },
    {
      kind: "code-block",
      title: "What the run looks like in practice",
      language: "text",
      code: `Q: Is Cyan the minimum?

[Read] {"file_path":"chart.png"}
[Bash] {"command":"python3 - <<'PY'\\nfrom PIL import Image\\nim=Image.open('chart.png')\\nw,h=im.size\\nx1,y1,x2,y2=0.4,0.6,0.7,0.9\\nim.crop((int(x1*w),int(y1*h),int(x2*w),int(y2*h))).save('crop.png')\\nPY"}
[Read] {"file_path":"crop.png"}

Yes — Cyan is the smallest slice in the pie chart, well under the next-smallest Light Slate.

$0.0182`,
    },
    {
      kind: "bullet-list",
      title: "Caveats and TODOs against the current worker bindings",
      items: [
        "One worker per useAssistant mount — by design. Two CropDemos render two workers, each with its own session and event stream.",
        "No allowed_tools from the cart yet. Sandbox by cwd today; add an opts field to the Claude branch of framework/assistant/worker_bindings.zig when this matters.",
        "No systemPrompt override from the cart for claude_code. Anything system-prompty rides on the user message.",
        "Image input is filesystem-only. No base64 image content blocks — Claude reads files. Always stage to cwd first.",
        "tool_call payload_json is backend-shaped and the inner `input` may be a JSON-encoded string. JSON.parse twice if needed before destructuring.",
      ],
    },
    {
      kind: "bullet-list",
      title: "Pattern summary",
      items: [
        "Stage the source image to a workspace dir.",
        "Mount useAssistant({ backend: 'claude_code', cwd, model }) — the hook owns the worker.",
        "ask(prompt) once the hook is ready, with the question + a 'use Read+Bash to crop, then Read the crop' instruction.",
        "Reduce the events array into your turn shape; tool_call events carry the Read/Bash invocations.",
        "close() / unmount when done; the hook tears the worker down automatically.",
      ],
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — this recipe is a custom-tool registration\n` +
      `  // pattern (Claude calls a Crop tool to refine image analysis), not\n` +
      `  // an event-driven rule. Substrate gap: tool registration lives on\n` +
      `  // the worker bindings layer, not the IFTTT bus. Recipe belongs as\n` +
      `  // an assistant-tool composition rather than a useIFTTT chain.\n`,
  },
};
