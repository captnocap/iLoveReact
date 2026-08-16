// editor/data/retopoIntents.ts — the fixed intent vocabulary for retopo-corpus
// annotation (req_4607), plus the writer that lands a selection's intent in the
// ACTIVE corpus entry. The vocabulary is CLOSED on purpose: named faces vary
// across 200 sessions, but a fixed set of reasons gives the training data one
// consistent gradient against the geometry each action keeps or deletes.
//
// The active entry is the corpus script's business: begin/resume write
// userdata/retopo-corpus/.active, finish removes it. Reading that file is what
// keeps this module free of shell-state plumbing — any UI site can record.

import type { ModelSelectionSnapshot } from '../model/modelSelectionFocus';

const host = globalThis as any;

const CORPUS_ROOT = 'userdata/retopo-corpus';
/** Selection ids are evidence, not a full dump — cap what one intent line carries. */
const MAX_IDS = 4096;

export type RetopoIntent = {
  id: string;
  /** chip text — short enough to sit in the stage header */
  label: string;
  hint: string;
};

export const RETOPO_INTENTS: RetopoIntent[] = [
  { id: 'looks-flat', label: 'flat', hint: 'reads as flat — this will collapse to a panel' },
  { id: 'keeping-bend', label: 'bend', hint: 'curvature is real — density here is deliberate' },
  { id: 'feature-edge', label: 'crease', hint: 'feature edge/crease line — must survive' },
  { id: 'detail-keep', label: 'detail', hint: 'ornament worth its triangles — ride through unchanged' },
  { id: 'soup-rebuild', label: 'rebuild', hint: 'deleting this soup to rebuild it clean' },
  { id: 'helper-temp', label: 'helper', hint: 'temporary helper geometry — will be deleted' },
  { id: 'over-spent', label: 'overspent', hint: 'too many triangles for what this shape is' },
];

/** The entry currently recording, or null. Cheap read of the script's marker file. */
export function activeCorpusEntry(): string | null {
  const raw = host.__fs_read?.(`${CORPUS_ROOT}/.active`);
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name.length > 0 ? name : null;
}

/** Append one intent line to the active entry. Returns the entry name, or null
 *  when nothing is recording (callers surface that as status, never silently). */
export function recordRetopoIntent(intentId: string, selection: ModelSelectionSnapshot | null): string | null {
  const entry = activeCorpusEntry();
  if (!entry) return null;
  const path = `${CORPUS_ROOT}/${entry}/intents.jsonl`;
  const line = JSON.stringify({
    at: Date.now(),
    intent: intentId,
    mode: selection?.mode ?? null,
    count: selection?.count ?? 0,
    affectedVertices: selection?.affectedVertices ?? 0,
    truncated: selection?.truncated ?? false,
    bounds: selection?.bounds ?? null,
    pivot: selection?.pivot ?? null,
    triangles: (selection?.triangles ?? []).slice(0, MAX_IDS).map((t: any) => t.id ?? t),
    vertices: (selection?.vertices ?? []).slice(0, MAX_IDS).map((v: any) => v.id ?? v),
  });
  const prev = host.__fs_read?.(path);
  const body = (typeof prev === 'string' ? prev : '') + line + '\n';
  return host.__fs_write?.(path, body) ? entry : null;
}
