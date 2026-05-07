// Entity → bucket mapping. The data shapes in cart/app/gallery/data/
// each route to exactly one bucket. Keep alphabetical within bucket so
// it's obvious where a new shape lands.
//
// New entity? Add it here AND add a CREATE TABLE in the bucket's
// migrations dir. The bootstrap reads this map to know which tables to
// create where.

import type { BucketId } from './buckets';

export const ENTITY_TO_BUCKET: Record<string, BucketId> = {
  // ── user (19) ─────────────────────────────────────────────────────
  'avatar': 'user',
  'calendar-dimension': 'user',
  'command-composer': 'user',
  'connection': 'user',
  'env-var': 'user',
  'environment': 'user',
  'layer-control-panel': 'user',
  'manifest-dimension': 'user',
  'menu-entry': 'user',
  'notification': 'user',
  'privacy': 'user',
  'role-assignment': 'user',
  'settings': 'user',
  'tool-permission': 'user',
  'toolbar': 'user',
  'user': 'user',
  'user-intervention': 'user',
  'user-manifest': 'user',
  'workspace': 'user',

  // ── assistant (34) ────────────────────────────────────────────────
  'assistant': 'assistant',
  'capability': 'assistant',
  'character': 'assistant',
  'character-archetype': 'assistant',
  'character-compatibility': 'assistant',
  'character-quirk': 'assistant',
  'chat-session': 'assistant',
  'chat-turn': 'assistant',
  'composition-source-kind': 'assistant',
  'constraint': 'assistant',
  'embedding-model': 'assistant',
  'event-adapter': 'assistant',
  'inference-parameter': 'assistant',
  'inference-preset': 'assistant',
  'inference-request': 'assistant',
  'interpretation': 'assistant',
  'model': 'assistant',
  'model-family': 'assistant',
  'model-route': 'assistant',
  'outcome-rubric': 'assistant',
  'personality-dial': 'assistant',
  'project-glossary': 'assistant',
  'prompt-composition': 'assistant',
  'prompt-fragment': 'assistant',
  'prompt-template': 'assistant',
  'provider': 'assistant',
  'quiz-session': 'assistant',
  'retrieval-query': 'assistant',
  'retrieval-strategy': 'assistant',
  'role': 'assistant',
  'skill': 'assistant',
  'supervisor': 'assistant',
  'system-message': 'assistant',

  // ── embeddings (8) ────────────────────────────────────────────────
  'chat-log-chunk': 'embeddings',
  'code-chunk': 'embeddings',
  'code-line': 'embeddings',
  'code-snippet': 'embeddings',
  'document-chunk': 'embeddings',
  'embedding': 'embeddings',
  'ingest-event': 'embeddings',
  'ingest-run': 'embeddings',

  // ── memories (5) ──────────────────────────────────────────────────
  'agent-memory': 'memories',
  'episodic-memory': 'memories',
  'procedural-memory': 'memories',
  'semantic-memory': 'memories',
  'working-memory': 'memories',

  // ── user-sweatshop (18) ───────────────────────────────────────────
  'budget': 'user-sweatshop',
  'budget-ledger': 'user-sweatshop',
  'chart-demo-data': 'user-sweatshop',
  'git-activity': 'user-sweatshop',
  'goal': 'user-sweatshop',
  'merge-conflict': 'user-sweatshop',
  'merge-proposal': 'user-sweatshop',
  'news-feed-post': 'user-sweatshop',
  'plan': 'user-sweatshop',
  'planning-phase': 'user-sweatshop',
  'project': 'user-sweatshop',
  'research': 'user-sweatshop',
  'spreadsheet': 'user-sweatshop',
  'task': 'user-sweatshop',
  'task-claim': 'user-sweatshop',
  'task-dependency': 'user-sweatshop',
  'task-graph': 'user-sweatshop',
  'workstream': 'user-sweatshop',

  // ── supervisor-sweatshop (7) ──────────────────────────────────────
  // The supervisor's domain: behavior floor, run-grain audit trails,
  // per-judgment records. Quarantined from user-sweatshop so a
  // supervisor-database corruption doesn't take user goal/plan data
  // with it.
  'barrier': 'supervisor-sweatshop',
  'claim': 'supervisor-sweatshop',
  'composition-run': 'supervisor-sweatshop',
  'pathology': 'supervisor-sweatshop',
  'pathology-detection': 'supervisor-sweatshop',
  'plan-deviation': 'supervisor-sweatshop',
  'supervisor-judgment': 'supervisor-sweatshop',

  // ── worker-sweatshop (16) ─────────────────────────────────────────
  'binary-shim': 'worker-sweatshop',
  'claude-cli-raw-event': 'worker-sweatshop',
  'codex-raw-event': 'worker-sweatshop',
  'event': 'worker-sweatshop',
  'job': 'worker-sweatshop',
  'job-run': 'worker-sweatshop',
  'model-output': 'worker-sweatshop',
  'rule': 'worker-sweatshop',
  'rule-firing': 'worker-sweatshop',
  'tool-call': 'worker-sweatshop',
  'verb-invocation': 'worker-sweatshop',
  'vm-image': 'worker-sweatshop',
  'vm-run': 'worker-sweatshop',
  'worker': 'worker-sweatshop',
  'worker-event': 'worker-sweatshop',
  'worker-session': 'worker-sweatshop',
  'worker-verb': 'worker-sweatshop',

  // ── provider-keys (0) ─────────────────────────────────────────────
  // Empty by design. Populate only if the cart starts storing key
  // material in-DB. Until then, env-var (refs) lives in `user`.
};

export function bucketFor(entity: string): BucketId {
  const b = ENTITY_TO_BUCKET[entity];
  if (!b) throw new Error(`No bucket registered for entity '${entity}'. Add it to cart/app/db/registry.ts.`);
  return b;
}

/** Entities grouped by bucket. Useful for bootstrap (CREATE TABLE per entry). */
export function entitiesByBucket(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [entity, bucket] of Object.entries(ENTITY_TO_BUCKET)) {
    if (!out[bucket]) out[bucket] = [];
    out[bucket].push(entity);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}
