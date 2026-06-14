// editors/workbench/story/store.ts — the STORYLINE BOARD's working store.
//
// Master half of the source: holds the editable mission drafts (seeded from the
// shipped MISSION_DEFINITIONS, deep-cloned so the frozen tables stay frozen),
// the current selection, and the mutators the panel binds. The board graph is
// DERIVED on read (buildQuestGraph) — never stored — so an edit to a gate
// reshapes the machine the next frame with no sync step.
//
// SLICE 1 is in-session (a singleton like requests/live.ts). Persistence to the
// V20 'story'/'missions' streams is the declared follow-up — the mutators are
// the seam it drops behind (every edit already routes through one writer).

import { MISSION_DEFINITIONS } from '../../../game/missions';
import type { MissionDef } from '../../../game/missions';
import type { ActivityVerb } from '../../../game/activities';
import { buildQuestGraph, type QuestGraph } from './model';

/** A mutable working copy of a MissionDef — the frozen tables are never touched. */
export type QuestDraft = {
  key: string;
  title: string;
  verb: ActivityVerb;
  client: string;
  binding?: MissionDef['binding'];
  requires: NonNullable<MissionDef['requires']>[number][];
  stages: MissionDef['stages'][number][];
  reward: { cash?: number; repDelta?: number };
  expiryTicks: number | null;
  collateral: { ratingDeltaPerCivilianKill: number };
  hooks: MissionDef['hooks'][number][];
  seed?: string;
};

function cloneDraft(def: MissionDef): QuestDraft {
  return JSON.parse(JSON.stringify({
    key: def.key,
    title: def.title,
    verb: def.verb,
    client: def.client,
    binding: def.binding,
    requires: def.requires ?? [],
    stages: def.stages,
    reward: def.reward,
    expiryTicks: def.expiryTicks,
    collateral: def.collateral,
    hooks: def.hooks,
    seed: def.seed,
  }));
}

export interface StoryStore {
  drafts(): QuestDraft[];
  graph(): QuestGraph;
  selectedKey(): string | null;
  select(key: string | null): void;
  draft(key: string): QuestDraft | null;
  /** the one writer — every mutator routes here (the persistence seam) */
  edit(key: string, mutate: (d: QuestDraft) => void): void;
  addFlagGate(key: string, flag: string): void;
  removeFlagGate(key: string, flag: string): void;
  subscribe(fn: () => void): () => void;
}

export function createStoryStore(seed: readonly MissionDef[]): StoryStore {
  const drafts: QuestDraft[] = seed.map(cloneDraft);
  let selected: string | null = drafts[0]?.key ?? null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };
  const byKey = (key: string) => drafts.find((d) => d.key === key) ?? null;

  // drafts cast to MissionDef-shape for derivation (graph reads only the fields
  // it needs; the working copies carry exactly those).
  const graphView = (): QuestGraph => buildQuestGraph(drafts as unknown as MissionDef[]);

  return {
    drafts: () => drafts,
    graph: graphView,
    selectedKey: () => selected,
    select: (key) => { selected = key; notify(); },
    draft: byKey,
    edit: (key, mutate) => {
      const d = byKey(key);
      if (!d) return;
      mutate(d);
      notify();
    },
    addFlagGate: (key, flag) => {
      const d = byKey(key);
      if (!d || !flag) return;
      if (d.requires.some((g) => g.kind === 'flag' && g.flag === flag)) return;
      d.requires.push({ kind: 'flag', flag });
      notify();
    },
    removeFlagGate: (key, flag) => {
      const d = byKey(key);
      if (!d) return;
      d.requires = d.requires.filter((g) => !(g.kind === 'flag' && g.flag === flag));
      notify();
    },
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

let live: StoryStore | null = null;

/** The in-session singleton, seeded from the shipped mission tables. */
export function storyWorkbenchStore(): StoryStore {
  if (!live) live = createStoryStore(Object.values(MISSION_DEFINITIONS));
  return live;
}
