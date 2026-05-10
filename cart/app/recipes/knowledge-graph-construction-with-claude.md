# Knowledge Graph Construction with Claude

You have a pile of unstructured documents and need to answer questions that span them — "who works with people who worked on project X", "which vendors are connected to this incident". RAG retrieval won't chain the facts. You need a knowledge graph: entities as nodes, typed relations as edges, multi-hop reasoning by graph traversal.

The original recipe uses `client.messages.parse()` with Pydantic schemas for structured output, two models (Haiku for extraction, Sonnet for resolution), and NetworkX for the graph. Here we adapt for the worker bindings: prompt for JSON inside fenced code blocks, parse it from the assistant text, hold the graph in plain JS state.

## Pipeline shape

```text
documents
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
grounded answer with edge citations
```

Each pass is a separate worker turn. The cart owns the loop; Claude only does the language work.

## Architecture in this repo

```text
.tsx cart  ── runOneTurn / useAssistant ──>  framework/assistant/worker_bindings.zig
                                              │
                                              └─ framework/assistant/claude_sdk/Session
                                                    └─ subprocess: `claude --input-format stream-json`
```

For batch pipelines like this one we use `runOneTurn` (a small Promise wrapper around the `__worker_*` host fns); for interactive UIs we use the `useAssistant` hook. Both share the same Zig-side WorkerStore, so the choice is purely ergonomic.

## Two-model strategy

The original uses Haiku for bulk extraction and Sonnet for resolution/synthesis. The worker contract accepts a `model` per turn, so the split is doable — `runOneTurn` opens a fresh worker per call, so each phase picks the right model directly. There's no extra cost or state loss because each phase reads/writes plain JS state, not session memory.

```typescript
const EXTRACTION_MODEL = 'claude-haiku-4-5';
const SYNTHESIS_MODEL  = 'claude-sonnet-4-6';
```

## runOneTurn helper

Every phase reuses this. It opens a worker, sends one prompt, accumulates the assistant text from the events stream, returns when the `completion` event lands.

```typescript
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
}
```

## JSON-fence parser

Claude doesn't have `messages.parse()` here. Ask for JSON inside a fenced block, then extract it. The prompt sets the contract; the parser is forgiving but strict about the fence.

```typescript
function extractJsonFence(reply: string): unknown {
  const m = reply.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`no JSON fence in reply:\n${reply.slice(0, 200)}`);
  return JSON.parse(m[1]);
}
```

If you see parse failures in practice, re-run with `"return ONLY a fenced JSON block, no prose"`. One nudge is usually enough.

## Phase 1: extraction

Per document, ask Claude to emit a typed entity + relation list.

```typescript
type EntityType = 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'EVENT' | 'ARTIFACT';

interface Entity {
  name: string;
  type: EntityType;
  description: string;
}
interface Relation {
  source: string;     // entity name
  predicate: string;  // short verb phrase
  target: string;     // entity name
}
interface ExtractedGraph {
  entities: Entity[];
  relations: Relation[];
}

const EXTRACTION_PROMPT = (text: string) => `Extract a knowledge graph from the document below.

<document>
${text}
</document>

Guidelines:
- Extract only entities central to the document.
- Use these types: PERSON, ORGANIZATION, LOCATION, EVENT, ARTIFACT.
- For each entity, give a one-sentence description.
- For each relation, write a short verb-phrase predicate ("founded", "launched on", "served as commander of").
- Do not invent facts that are not in the document.

Return ONLY a fenced JSON block. Schema:

\`\`\`json
{
  "entities": [{"name": "...", "type": "PERSON", "description": "..."}],
  "relations": [{"source": "...", "predicate": "...", "target": "..."}]
}
\`\`\``;

async function extract(cwd: string, doc: { title: string; text: string }): Promise<ExtractedGraph> {
  const reply = await runOneTurn(
    { backend: 'claude_code', cwd, model: EXTRACTION_MODEL },
    EXTRACTION_PROMPT(doc.text),
  );
  return extractJsonFence(reply) as ExtractedGraph;
}
```

Loop over documents:

```typescript
const rawEntities: (Entity & { source_doc: string })[] = [];
const rawRelations: (Relation & { source_doc: string })[] = [];

for (const doc of documents) {
  try {
    const g = await extract(cwd, doc);
    for (const e of g.entities) rawEntities.push({ ...e, source_doc: doc.title });
    for (const r of g.relations) rawRelations.push({ ...r, source_doc: doc.title });
    console.log(`${doc.title}: +${g.entities.length} entities, +${g.relations.length} relations`);
  } catch (err) {
    console.warn(`extract failed for ${doc.title}:`, err);
  }
}
```

## Phase 2: entity resolution

Surface forms duplicate ("NASA" vs "National Aeronautics and Space Administration"). Cluster by type and let Claude pick a canonical for each cluster.

```typescript
interface Cluster {
  canonical: string;
  aliases: string[];
}

const RESOLVE_PROMPT = (entityType: string, list: string) => `Below are ${entityType} entities extracted from several documents. Some are duplicates with different surface forms.

Group them into clusters of the same real-world entity and pick a canonical name for each cluster.

<entities>
${list}
</entities>

Return ONLY a fenced JSON block. Schema:

\`\`\`json
{
  "clusters": [
    {"canonical": "...", "aliases": ["...", "..."]}
  ]
}
\`\`\``;

async function resolveType(
  cwd: string,
  entityType: EntityType,
  entities: (Entity & { source_doc: string })[],
): Promise<Cluster[]> {
  const unique = new Map<string, string>();
  for (const e of entities) if (!unique.has(e.name)) unique.set(e.name, e.description);
  const list = [...unique].map(([name, desc]) => `- ${name}: ${desc}`).join('\n');
  const reply = await runOneTurn(
    { backend: 'claude_code', cwd, model: SYNTHESIS_MODEL },
    RESOLVE_PROMPT(entityType, list),
  );
  return (extractJsonFence(reply) as { clusters: Cluster[] }).clusters;
}
```

Build the alias-to-canonical map:

```typescript
const aliasToCanonical = new Map<string, string>();
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
}
```

## Phase 3: assemble the graph

Plain-data graph — no NetworkX dependency. A directed multigraph: many edges allowed between the same endpoints with different predicates.

```typescript
interface GraphNode {
  name: string;
  type: EntityType;
  description: string;
  source_docs: Set<string>;
  mentions: number;
}
interface GraphEdge {
  source: string;     // canonical name
  target: string;     // canonical name
  predicate: string;
  source_doc: string;
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

console.log(`Graph: ${nodes.size} nodes, ${edges.length} edges`);
```

## Phase 4: query as subgraph traversal

Center on a node, walk N hops, serialize the local subgraph, ask Sonnet using only that as context.

```typescript
function neighborhood(center: string, hops: number): { nodes: Set<string>; edges: GraphEdge[] } {
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
    const k = `${e.source}|${e.predicate}|${e.target}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`(${e.source}) --[${e.predicate}]--> (${e.target})`);
  }
  return lines.sort().join('\n');
}

async function ask(cwd: string, question: string, center: string, hops = 2): Promise<string> {
  const sub = neighborhood(center, hops);
  const ctx = serializeEdges(sub.edges);
  const prompt = `Answer using only the knowledge graph below. Cite the edges you used.

<graph>
${ctx}
</graph>

Question: ${question}`;
  return runOneTurn({ backend: 'claude_code', cwd, model: SYNTHESIS_MODEL }, prompt);
}
```

## Evaluation against a gold set

Score raw extraction recall and post-resolution recall on a small hand-labeled set:

```typescript
function prf(predicted: Set<string>, gold: Set<string>): { p: number; r: number; f1: number } {
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
  console.log(`${docTitle}  raw F1=${rawScore.f1.toFixed(2)}  resolved R=${resScore.r.toFixed(2)}`);
}
```

## Caveats and TODOs against the worker bindings

- **No `messages.parse` / structured output.** We ask for JSON fences and parse them ourselves. Add an explicit "return ONLY a fenced JSON block" line; budget one retry on parse failure.
- **One worker per `runOneTurn` call.** Each call carries the spawn cost of starting the claude subprocess. Acceptable for batch pipelines; for interactive flows reach for `useAssistant` which keeps a worker warm across mounts.
- **Phases run sequentially as written.** The worker contract supports many concurrent workers — fan extractions out via `Promise.all(documents.map(d => extract(...)))` if the spawn cost is worth the parallelism.
- **No `add_dirs` from cart.** All documents have to live under `cwd` if you want Claude to read them; otherwise pass content inline in the prompt. For Wikipedia summaries (the original demo), inlining is the right call.
- **Cost telemetry is per-completion.** `cost_usd_delta` lands on each `completion` event in the events stream. Sum it across phases yourself if you want a graph-build total — wrap `runOneTurn` to return `{ text, cost }`.

## Pattern summary

1. One worker turn per phase per document/type. `runOneTurn` opens, sends, drains, closes.
2. Prompt for JSON inside a fenced block; parse out of the assistant text.
3. Resolve aliases per type using the description as the disambiguation signal.
4. Hold the graph in plain JS Maps/arrays — no NetworkX needed.
5. Query by walking N hops, serializing the subgraph, asking Sonnet against that context only.
6. Evaluate raw vs resolved recall against a small gold set; tune extraction prompt accordingly.

The graph is pure data. The model only does language: extracting, clustering aliases, answering with citations.
