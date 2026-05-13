import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "knowledge-graph-construction-with-claude",
  title: "Knowledge Graph Construction with Claude",
  sourcePath: "cart/app/recipes/knowledge-graph-construction-with-claude.md",
  instructions:
    "Build an in-memory knowledge graph from unstructured documents using Claude through the unified worker contract. Two-phase pipeline (extract → resolve aliases → assemble → query). Each phase is a fresh worker turn driven through useAssistant for in-component flows, or via a small runOneTurn helper that talks directly to the __worker_* host fns for batch pipelines outside React render. JSON-fence parsing replaces the original recipe's messages.parse() since structured output isn't exposed by our subprocess pathway.",
  sections: [
    {
      kind: "paragraph",
      text:
        "The original recipe uses client.messages.parse() with Pydantic schemas, two models (Haiku for extraction, Sonnet for resolution), and NetworkX. We adapt for the worker contract: prompt for JSON inside fenced code blocks, parse it from the assistant_message events, hold the graph in plain JS state.",
    },
    {
      kind: "code-block",
      title: "Pipeline shape",
      language: "text",
      code: `documents
   │ (extract — one worker turn per doc)
   ▼
raw entities + raw relations
   │ (resolve — group by entity type, one worker turn per type)
   ▼
canonical entities + alias map
   ▼
in-memory graph: { nodes: Map, edges: Array }
   │ (query — subgraph + ask)
   ▼
grounded answer with edge citations`,
    },
    {
      kind: "code-block",
      title: "Two-model strategy: model swap = worker respawn",
      language: "typescript",
      code: `const EXTRACTION_MODEL = 'claude-haiku-4-5';
const SYNTHESIS_MODEL  = 'claude-sonnet-4-6';

// Each phase opens its own worker with the right model.
// Closing + reopening between phases is fine and cheap because each phase
// reads/writes plain JS state, not in-session conversation memory.`,
    },
    {
      kind: "code-block",
      title: "runOneTurn helper — Promise wrapper around the worker host fns",
      language: "typescript",
      code: `// useAssistant is the React-hook surface; for batch pipelines outside
// render we talk to the underlying __worker_* fns directly. The hook and
// this helper share the same Zig-side WorkerStore.

import { callHost, hasHost } from '@reactjit/runtime/ffi';

type Backend = 'claude_code' | 'codex_app_server' | 'kimi_cli_wire' | 'local_ai' | 'openai_compat';

interface OneTurnOpts {
  backend: Backend;
  cwd?: string;
  model?: string;
  // ...other useAssistant opts; see runtime/hooks/useAssistant.ts
}

export async function runOneTurn(opts: OneTurnOpts, prompt: string): Promise<string> {
  if (!hasHost('__worker_start')) throw new Error('worker bindings not registered');
  const wid = callHost('__worker_start', opts.backend, JSON.stringify(opts)) as string;
  if (!wid) throw new Error('worker_start failed');
  if (!callHost('__worker_send', wid, prompt)) {
    callHost('__worker_close', wid);
    throw new Error('worker_send failed');
  }
  let text = '';
  while (true) {
    const events = (callHost('__worker_poll', wid) as any[]) ?? [];
    for (const ev of events) {
      if (ev.kind === 'assistant_message' && ev.text) text += ev.text;
      else if (ev.kind === 'completion') {
        callHost('__worker_close', wid);
        return text;
      } else if (ev.kind === 'error_') {
        callHost('__worker_close', wid);
        throw new Error(ev.text || 'worker error');
      }
    }
    await new Promise(r => setTimeout(r, 50));
  }
}`,
    },
    {
      kind: "code-block",
      title: "JSON-fence parser (replaces messages.parse)",
      language: "typescript",
      code: `function extractJsonFence(reply: string): unknown {
  const m = reply.match(/\\\`\\\`\\\`(?:json)?\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\`/);
  if (!m) throw new Error(\`no JSON fence in reply:\\n\${reply.slice(0, 200)}\`);
  return JSON.parse(m[1]);
}

// On parse failure: re-run runOneTurn with "return ONLY a fenced JSON block,
// no prose". One nudge is usually enough.`,
    },
    {
      kind: "code-block",
      title: "Phase 1: extraction — types and prompt",
      language: "typescript",
      code: `type EntityType = 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'EVENT' | 'ARTIFACT';

interface Entity { name: string; type: EntityType; description: string; }
interface Relation { source: string; predicate: string; target: string; }
interface ExtractedGraph { entities: Entity[]; relations: Relation[]; }

const EXTRACTION_PROMPT = (text: string) => \`Extract a knowledge graph from the document below.

<document>
\${text}
</document>

Guidelines:
- Extract only entities central to the document.
- Use these types: PERSON, ORGANIZATION, LOCATION, EVENT, ARTIFACT.
- For each entity, give a one-sentence description.
- For each relation, write a short verb-phrase predicate ("founded", "launched on").
- Do not invent facts that are not in the document.

Return ONLY a fenced JSON block. Schema:

\\\`\\\`\\\`json
{
  "entities": [{"name": "...", "type": "PERSON", "description": "..."}],
  "relations": [{"source": "...", "predicate": "...", "target": "..."}]
}
\\\`\\\`\\\`\`;

async function extract(cwd: string, doc: { title: string; text: string }): Promise<ExtractedGraph> {
  const reply = await runOneTurn(
    { backend: 'claude_code', cwd, model: EXTRACTION_MODEL },
    EXTRACTION_PROMPT(doc.text),
  );
  return extractJsonFence(reply) as ExtractedGraph;
}`,
    },
    {
      kind: "code-block",
      title: "Phase 1: extraction loop",
      language: "typescript",
      code: `const rawEntities: (Entity & { source_doc: string })[] = [];
const rawRelations: (Relation & { source_doc: string })[] = [];

for (const doc of documents) {
  try {
    const g = await extract(cwd, doc);
    for (const e of g.entities) rawEntities.push({ ...e, source_doc: doc.title });
    for (const r of g.relations) rawRelations.push({ ...r, source_doc: doc.title });
    console.log(\`\${doc.title}: +\${g.entities.length} entities, +\${g.relations.length} relations\`);
  } catch (err) {
    console.warn(\`extract failed for \${doc.title}:\`, err);
  }
}`,
    },
    {
      kind: "code-block",
      title: "Phase 2: entity resolution per type",
      language: "typescript",
      code: `interface Cluster { canonical: string; aliases: string[]; }

const RESOLVE_PROMPT = (entityType: string, list: string) => \`Below are \${entityType} entities extracted from several documents. Some are duplicates with different surface forms.

Group them into clusters of the same real-world entity and pick a canonical name for each cluster.

<entities>
\${list}
</entities>

Return ONLY a fenced JSON block. Schema:

\\\`\\\`\\\`json
{
  "clusters": [
    {"canonical": "...", "aliases": ["...", "..."]}
  ]
}
\\\`\\\`\\\`\`;

async function resolveType(
  cwd: string,
  entityType: EntityType,
  entities: (Entity & { source_doc: string })[],
): Promise<Cluster[]> {
  const unique = new Map<string, string>();
  for (const e of entities) if (!unique.has(e.name)) unique.set(e.name, e.description);
  const list = [...unique].map(([name, desc]) => \`- \${name}: \${desc}\`).join('\\n');
  const reply = await runOneTurn(
    { backend: 'claude_code', cwd, model: SYNTHESIS_MODEL },
    RESOLVE_PROMPT(entityType, list),
  );
  return (extractJsonFence(reply) as { clusters: Cluster[] }).clusters;
}`,
    },
    {
      kind: "code-block",
      title: "Build the alias→canonical map",
      language: "typescript",
      code: `const aliasToCanonical = new Map<string, string>();
const canonicalInfo = new Map<string, { type: EntityType; aliases: string[] }>();

const entityTypes: EntityType[] = ['PERSON', 'ORGANIZATION', 'LOCATION', 'EVENT', 'ARTIFACT'];
for (const t of entityTypes) {
  const ofType = rawEntities.filter(e => e.type === t);
  if (ofType.length === 0) continue;
  let clusters: Cluster[];
  try { clusters = await resolveType(cwd, t, ofType); }
  catch { clusters = [...new Set(ofType.map(e => e.name))]
    .map(n => ({ canonical: n, aliases: [n] })); }
  for (const c of clusters) {
    canonicalInfo.set(c.canonical, { type: t, aliases: c.aliases });
    for (const a of c.aliases) aliasToCanonical.set(a, c.canonical);
  }
}`,
    },
    {
      kind: "code-block",
      title: "Phase 3: assemble the graph (plain Maps + array)",
      language: "typescript",
      code: `interface GraphNode {
  name: string; type: EntityType; description: string;
  source_docs: Set<string>; mentions: number;
}
interface GraphEdge {
  source: string; target: string; predicate: string; source_doc: string;
}

const nodes = new Map<string, GraphNode>();
const edges: GraphEdge[] = [];

for (const e of rawEntities) {
  const c = aliasToCanonical.get(e.name);
  if (!c) continue;
  let node = nodes.get(c);
  if (!node) {
    node = { name: c, type: canonicalInfo.get(c)!.type,
             description: e.description, source_docs: new Set(), mentions: 0 };
    nodes.set(c, node);
  }
  node.source_docs.add(e.source_doc);
  node.mentions += 1;
}

for (const r of rawRelations) {
  const s = aliasToCanonical.get(r.source);
  const t = aliasToCanonical.get(r.target);
  if (!s || !t || s === t) continue;
  edges.push({ source: s, target: t, predicate: r.predicate, source_doc: r.source_doc });
}

console.log(\`Graph: \${nodes.size} nodes, \${edges.length} edges\`);`,
    },
    {
      kind: "code-block",
      title: "Phase 4: query as subgraph traversal",
      language: "typescript",
      code: `function neighborhood(center: string, hops: number): { nodes: Set<string>; edges: GraphEdge[] } {
  const visited = new Set<string>([center]);
  let frontier = new Set<string>([center]);
  for (let i = 0; i < hops; i++) {
    const next = new Set<string>();
    for (const e of edges) {
      if (frontier.has(e.source) && !visited.has(e.target)) next.add(e.target);
      if (frontier.has(e.target) && !visited.has(e.source)) next.add(e.source);
    }
    for (const n of next) visited.add(n);
    frontier = next;
    if (frontier.size === 0) break;
  }
  const sub = edges.filter(e => visited.has(e.source) && visited.has(e.target));
  return { nodes: visited, edges: sub };
}

function serializeEdges(es: GraphEdge[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of es) {
    const k = \`\${e.source}|\${e.predicate}|\${e.target}\`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(\`(\${e.source}) --[\${e.predicate}]--> (\${e.target})\`);
  }
  return lines.sort().join('\\n');
}

async function ask(cwd: string, question: string, center: string, hops = 2): Promise<string> {
  const sub = neighborhood(center, hops);
  const ctx = serializeEdges(sub.edges);
  const prompt = \`Answer using only the knowledge graph below. Cite the edges you used.

<graph>
\${ctx}
</graph>

Question: \${question}\`;
  return runOneTurn({ backend: 'claude_code', cwd, model: SYNTHESIS_MODEL }, prompt);
}`,
    },
    {
      kind: "code-block",
      title: "Evaluation against a gold set",
      language: "typescript",
      code: `function prf(predicted: Set<string>, gold: Set<string>): { p: number; r: number; f1: number } {
  let tp = 0;
  for (const x of predicted) if (gold.has(x)) tp += 1;
  const p = predicted.size ? tp / predicted.size : 0;
  const r = gold.size ? tp / gold.size : 0;
  const f1 = (p + r) ? (2 * p * r) / (p + r) : 0;
  return { p, r, f1 };
}

const norm = (s: string) => s.toLowerCase().trim();

for (const [docTitle, labels] of Object.entries(gold)) {
  const goldNames = new Set(labels.entities.map(e => norm(e.name)));
  const raw = new Set(rawEntities.filter(e => e.source_doc === docTitle).map(e => norm(e.name)));
  const resolved = new Set(rawEntities.filter(e => e.source_doc === docTitle)
    .map(e => norm(aliasToCanonical.get(e.name) ?? e.name)));
  const rawScore = prf(raw, goldNames);
  const resScore = prf(resolved, goldNames);
  console.log(\`\${docTitle}  raw F1=\${rawScore.f1.toFixed(2)}  resolved R=\${resScore.r.toFixed(2)}\`);
}`,
    },
    {
      kind: "bullet-list",
      title: "Caveats and TODOs against the worker bindings",
      items: [
        "No messages.parse / structured output. Ask for JSON fences and parse manually; budget one retry on parse failure.",
        "runOneTurn opens one worker per call — each carries the spawn cost of starting the claude subprocess. Acceptable for batch pipelines; for interactive flows reach for useAssistant which keeps a worker warm across mounts.",
        "Phases are sequential as written. Multiple workers can run in parallel — call runOneTurn from several await Promise.all() arms — but each backend has its own spawn cost.",
        "No add_dirs from the cart. Documents must live under cwd, or be inlined in the prompt. For Wikipedia-style summaries, inlining is correct.",
        "Cost telemetry is per-completion, not per-graph. Sum cost_usd_delta across the events array (or wrap runOneTurn to return both text and cost) for a graph-build total.",
      ],
    },
    {
      kind: "bullet-list",
      title: "Pattern summary",
      items: [
        "One worker turn per phase per document/type. runOneTurn opens, sends, drains, closes.",
        "Prompt for JSON inside a fenced block; parse out of the assistant_message text.",
        "Resolve aliases per type using the description as the disambiguation signal.",
        "Hold the graph in plain JS Maps/arrays — no NetworkX needed.",
        "Query by walking N hops, serializing the subgraph, asking Sonnet against that context only.",
        "Evaluate raw vs resolved recall against a small gold set; tune extraction prompt accordingly.",
      ],
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — this recipe is a multi-stage extraction\n` +
      `  // pipeline (chunk → extract triples → resolve aliases → store →\n` +
      `  // query), not a 2-node useIFTTT chain. Likely needs composition-\n` +
      `  // shaped recipes with named stages on a worker pipeline rather\n` +
      `  // than the flat trigger→action shape useIFTTT carries.\n`,
  },
};
