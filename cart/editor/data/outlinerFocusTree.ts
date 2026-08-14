// data/outlinerFocusTree.ts — the merged-outliner join (req_4392).
//
// One tree owns everything per part: named face regions, logical edge paths,
// and the mechanical-rig lane (hinge / mount / contact edge roles). This module
// is the PURE join between the outliner's part table and the semantic rows the
// focus bridge publishes — no host doors, no React.
//
// Attribution is exact, never guessed:
//   · a FACE region attaches to the part whose authored-group range [lo, hi)
//     CONTAINS the region's resident group span (host percept `groups` field);
//     a region spanning several parts — or read from a host predating the
//     field — stays in the unattributed bucket rather than wearing a guess.
//   · an EDGE region attaches by its objectId, which IS the outliner part id
//     at naming time (AppFrame names edge paths against modelActivePartId).
import type { ModelPart } from './types';
import type {
  ModelFocusEdgeSemanticRow,
  ModelFocusFaceSemanticRow,
  ModelFocusSemanticRow,
} from '../model/modelSemanticsFocus';

/** Edge-path roles that belong to the rig lane (purple), not the edge lane. */
export const OUTLINER_RIG_EDGE_ROLES = ['hinge', 'mount', 'contact'] as const;

export type OutlinerAttachment =
  | { kind: 'region'; id: number; name: string; meta: string }
  | { kind: 'edge'; id: number; name: string; meta: string }
  | { kind: 'rig'; id: number; name: string; meta: string };

export type PartAttachments = {
  rigs: OutlinerAttachment[];
  regions: OutlinerAttachment[];
  edges: OutlinerAttachment[];
  /** Collapsed-row summary, '2 rgn · 1 edg · 1 rig' — empty for a bare part. */
  summary: string;
};

export type OutlinerFocusTree = {
  byPart: Map<string, PartAttachments>;
  /** Rows no part can own exactly — multi-part regions, pre-field hosts,
   *  edge paths naming a part that no longer exists. */
  unattributed: OutlinerAttachment[];
  /** Header totals: N rgn · N edg · N rig across every resident row. */
  totals: { regions: number; edges: number; rigs: number };
};

const EMPTY_ATTACHMENTS: PartAttachments = { rigs: [], regions: [], edges: [], summary: '' };

function summarize(regions: number, edges: number, rigs: number): string {
  const chunks: string[] = [];
  if (regions > 0) chunks.push(`${regions} rgn`);
  if (edges > 0) chunks.push(`${edges} edg`);
  if (rigs > 0) chunks.push(`${rigs} rig`);
  return chunks.join(' · ');
}

function regionAttachment(row: ModelFocusFaceSemanticRow): OutlinerAttachment {
  const instances = row.instances > 1 ? ` · ${row.instances}x` : '';
  return { kind: 'region', id: row.id, name: row.name, meta: `${row.faces} tris${instances}` };
}

function edgeAttachment(row: ModelFocusEdgeSemanticRow): OutlinerAttachment {
  const rig = (OUTLINER_RIG_EDGE_ROLES as readonly string[]).includes(row.role);
  return {
    kind: rig ? 'rig' : 'edge',
    id: row.id,
    name: row.name,
    meta: rig
      ? `${row.role} · ${row.edges} edges`
      : `${row.edges} edges · ${row.closed ? 'closed' : 'open'}`,
  };
}

/** Join the semantic rows onto the part table. Only RESIDENT rows attach —
 *  saved-only/mount-only ghosts belong to the NAMES pane's horizon story. */
export function outlinerFocusTree(
  parts: readonly ModelPart[],
  rows: readonly ModelFocusSemanticRow[],
): OutlinerFocusTree {
  const byPart = new Map<string, PartAttachments>();
  const unattributed: OutlinerAttachment[] = [];
  const totals = { regions: 0, edges: 0, rigs: 0 };
  const ensure = (partId: string): PartAttachments => {
    let entry = byPart.get(partId);
    if (!entry) {
      entry = { rigs: [], regions: [], edges: [], summary: '' };
      byPart.set(partId, entry);
    }
    return entry;
  };
  const partById = new Map(parts.map((part) => [part.id, part]));
  const ownerOfSpan = (span: [number, number]): ModelPart | null => {
    for (const part of parts) {
      if (part.lo == null || part.hi == null) continue;
      if (part.lo <= span[0] && span[1] <= part.hi) return part;
    }
    return null;
  };
  for (const row of rows) {
    if (row.presence !== 'resident' && row.presence !== 'not-visible') continue;
    if (row.kind === 'face') {
      const attachment = regionAttachment(row);
      totals.regions += 1;
      const owner = row.groupSpan ? ownerOfSpan(row.groupSpan) : null;
      if (owner) ensure(owner.id).regions.push(attachment);
      else unattributed.push(attachment);
    } else {
      const attachment = edgeAttachment(row);
      if (attachment.kind === 'rig') totals.rigs += 1;
      else totals.edges += 1;
      const owner = partById.get(row.objectId) ?? null;
      if (owner) ensure(owner.id)[attachment.kind === 'rig' ? 'rigs' : 'edges'].push(attachment);
      else unattributed.push(attachment);
    }
  }
  for (const entry of byPart.values()) {
    entry.summary = summarize(entry.regions.length, entry.edges.length, entry.rigs.length);
  }
  return { byPart, unattributed, totals };
}

export function partAttachments(tree: OutlinerFocusTree, partId: string): PartAttachments {
  return tree.byPart.get(partId) ?? EMPTY_ATTACHMENTS;
}

/** The outliner header's counts line: '17 · 25 rgn · 4 rig' (parts first). */
export function outlinerHeaderCounts(partCount: number, tree: OutlinerFocusTree): string {
  const summary = summarize(tree.totals.regions, tree.totals.edges, tree.totals.rigs);
  return summary ? `${partCount} · ${summary}` : String(partCount);
}
