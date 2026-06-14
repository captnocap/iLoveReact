// editors/workbench/story/model.ts — the STORYLINE BOARD model: a pure
// derivation of the conditional state machine from the mission tables. No
// React, no host (the characters.test.ts bundling law) — buildQuestGraph is a
// pure function of MissionDefs, so model.test.ts proves the edges without a
// running cart.
//
// THE STATE MACHINE, derived (V22 — "missions are rows over a closed schema;
// the validator proves affordances"): a mission `provides` the story flags its
// narrative hooks set (worldDelta.setFlag — the only delta key that opens a
// gate), and `requires` the flags its unlock gate names (defs.ts MissionDef
// .requires, the SAME StoryCondition vocabulary arcs gate on). An EDGE A→B
// exists when B requires a flag A provides — that is the whole board. A
// required flag with no provider in the set is EXTERNAL (an arc beat or another
// system opens it); we surface it, never hide it (PROTECT THE ZERO — an unmet
// gate is a fact the author must see, not a silent dead node).

import type { MissionDef } from '../../../game/missions';
import type { StoryCondition } from '../../../game/story';

/** A node on the board — one mission, with its derived gate flags + layout. */
export type QuestNode = {
  key: string;
  title: string;
  verb: string;
  /** who posted it (MissionDef.client) */
  client: string;
  /** the V22 contract binding, flattened for the chip */
  binding: 'person' | 'position' | 'job';
  bindingId?: string;
  /** flag gates that must hold to offer (the inbound side) */
  requiresFlags: string[];
  /** non-flag gates (counter/event) — shown but not edge-derived yet */
  requiresOther: StoryCondition[];
  /** flags this mission's hooks set (the outbound side) */
  providesFlags: string[];
  /** longest-path layer from a root — the board COLUMN */
  depth: number;
  /** stable row within the column, for layout */
  lane: number;
  /** weakly-connected component index — the geometric fallback grouping */
  questline: number;
  /** the DISPLAY questline: the author's explicit `questline` name when set,
   *  else the derived `Q<n>` of the connected component. The board groups by
   *  this — naming a quest's questline is how the user organizes the line. */
  questlineLabel: string;
};

/** A dependency edge: the provider opens a flag the requirer gates on. */
export type QuestEdge = { from: string; to: string; flag: string };

export type QuestGraph = {
  nodes: QuestNode[];
  edges: QuestEdge[];
  /** required flags no mission in the set provides — opened by arcs/other systems */
  external: { to: string; flag: string }[];
};

/** The flags a mission opens: every hook worldDelta `setFlag` (string) or
 *  `setFlags` (string[]). The one delta convention that feeds a gate. */
export function providesFlags(def: MissionDef): string[] {
  const out = new Set<string>();
  for (const hook of def.hooks) {
    const delta = hook.worldDelta as Record<string, unknown>;
    if (typeof delta.setFlag === 'string') out.add(delta.setFlag);
    if (Array.isArray(delta.setFlags)) {
      for (const f of delta.setFlags) if (typeof f === 'string') out.add(f);
    }
  }
  return [...out];
}

/** The flag gates a mission requires (the edge-bearing kind). */
export function requiresFlags(def: MissionDef): string[] {
  return (def.requires ?? [])
    .filter((g): g is Extract<StoryCondition, { kind: 'flag' }> => g.kind === 'flag')
    .map((g) => g.flag);
}

function requiresOther(def: MissionDef): StoryCondition[] {
  return (def.requires ?? []).filter((g) => g.kind !== 'flag');
}

function flatBinding(def: MissionDef): Pick<QuestNode, 'binding' | 'bindingId'> {
  if (!def.binding) return { binding: 'job' };
  return def.binding.kind === 'person'
    ? { binding: 'person', bindingId: def.binding.npcId }
    : { binding: 'position', bindingId: def.binding.positionId };
}

/** Build the conditional state machine from a set of mission tables. Pure. */
export function buildQuestGraph(defs: readonly MissionDef[]): QuestGraph {
  // provider index: flag → the mission keys that open it
  const providerOf = new Map<string, string[]>();
  for (const def of defs) {
    for (const flag of providesFlags(def)) {
      const list = providerOf.get(flag) ?? [];
      list.push(def.key);
      providerOf.set(flag, list);
    }
  }

  const edges: QuestEdge[] = [];
  const external: { to: string; flag: string }[] = [];
  for (const def of defs) {
    for (const flag of requiresFlags(def)) {
      const providers = providerOf.get(flag);
      if (!providers || providers.length === 0) {
        external.push({ to: def.key, flag });
        continue;
      }
      for (const from of providers) {
        if (from !== def.key) edges.push({ from, to: def.key, flag });
      }
    }
  }

  const depth = longestPathDepth(defs, edges);
  const questline = weaklyConnectedComponents(defs, edges);
  const lane = laneWithinColumn(defs, depth, questline);

  const nodes: QuestNode[] = defs.map((def) => {
    const component = questline.get(def.key) ?? 0;
    const named = ((def as { questline?: string }).questline ?? '').trim();
    return {
      key: def.key,
      title: def.title,
      verb: def.verb,
      client: def.client,
      ...flatBinding(def),
      requiresFlags: requiresFlags(def),
      requiresOther: requiresOther(def),
      providesFlags: providesFlags(def),
      depth: depth.get(def.key) ?? 0,
      lane: lane.get(def.key) ?? 0,
      questline: component,
      questlineLabel: named || `Q${component + 1}`,
    };
  });

  return { nodes, edges, external };
}

/** Longest-path layering: a node sits one column right of its deepest
 *  prerequisite. Cycles (an authoring mistake) are broken by visit order so the
 *  board never hangs — a cycle just renders flat, not infinitely. */
function longestPathDepth(defs: readonly MissionDef[], edges: readonly QuestEdge[]): Map<string, number> {
  const incoming = new Map<string, QuestEdge[]>();
  for (const def of defs) incoming.set(def.key, []);
  for (const e of edges) incoming.get(e.to)?.push(e);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const resolve = (key: string): number => {
    const cached = depth.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 0; // cycle guard
    visiting.add(key);
    let best = 0;
    for (const e of incoming.get(key) ?? []) best = Math.max(best, resolve(e.from) + 1);
    visiting.delete(key);
    depth.set(key, best);
    return best;
  };
  for (const def of defs) resolve(def.key);
  return depth;
}

/** Weakly-connected components over the UNDIRECTED edge set — each component is
 *  one questline (a self-contained dependency island). */
function weaklyConnectedComponents(
  defs: readonly MissionDef[],
  edges: readonly QuestEdge[],
): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const def of defs) parent.set(def.key, def.key);
  for (const e of edges) {
    const a = find(e.from);
    const b = find(e.to);
    if (a !== b) parent.set(a, b);
  }
  // stable component ids by first-seen root order
  const idOf = new Map<string, number>();
  const out = new Map<string, number>();
  for (const def of defs) {
    const root = find(def.key);
    if (!idOf.has(root)) idOf.set(root, idOf.size);
    out.set(def.key, idOf.get(root)!);
  }
  return out;
}

/** Assign each node a lane (row) within its (questline, depth) cell so two
 *  missions at the same column don't overlap. Deterministic: authored order. */
function laneWithinColumn(
  defs: readonly MissionDef[],
  depth: Map<string, number>,
  questline: Map<string, number>,
): Map<string, number> {
  const seen = new Map<string, number>(); // `${questline}:${depth}` → next lane
  const lane = new Map<string, number>();
  for (const def of defs) {
    const cell = `${questline.get(def.key) ?? 0}:${depth.get(def.key) ?? 0}`;
    const next = seen.get(cell) ?? 0;
    lane.set(def.key, next);
    seen.set(cell, next + 1);
  }
  return lane;
}
