// editors/workbench/story/store.ts — the STORYLINE BOARD's working store.
//
// THE AUTHORED SHAPE IS THE USER'S (req_0910/req_0914), not MissionDef's: a
// quest is title / id / author / questline / fromNPC / desc / reward /
// dependents / constraints / events(cutscene, location, order, dialog). The
// store holds that shape directly as the editable draft; the runtime MissionDef
// is the PROJECTION (events→stages, constraints→requires, fromNPC→client) the
// compile step makes — so authoring reads as the user thinks while still riding
// the ruled substrate. Fields MissionDef lacks (author, questline, desc, and
// per-event location/cutscene/dialog) live here and persist with the editor.
//
// The board graph is DERIVED on read (buildQuestGraph) — never stored. Drafts
// seed from the shipped MISSION_DEFINITIONS (deep-cloned; the frozen tables stay
// frozen). SLICE state is in-session (a singleton); the V20 'storyline' stream
// is the declared persistence follow-up — every edit already routes through the
// one writer (edit), which is its seam.

import { MISSION_DEFINITIONS } from '../../../game/missions';
import type { MissionDef } from '../../../game/missions';
import type { ActivityVerb } from '../../../game/activities';
import { buildQuestGraph, type QuestGraph } from './model';

/** One spoken line inside an event (the V16 cutscene-clock dialog). */
export type QuestDialogLine = { speaker: string; text: string };

/** THE USER'S "event": an ordered beat carrying its cutscene, location, and
 *  dialog. Order is the array index. Objectives stay as the mission predicate
 *  vocabulary (deep target-pickers are the next pass). */
export type QuestEvent = {
  id: string;
  /** one line of player-facing meaning (the beat's desc) */
  brief: string;
  /** where it happens — the world blip (meters); absent = no marker */
  location?: { x: number; z: number };
  /** the cutscene def id this beat plays (game/cutscene/), or '' for none */
  cutscene: string;
  dialog: QuestDialogLine[];
  /** completion predicates (MissionStage.objectives shape) */
  objectives: MissionDef['stages'][number]['objectives'][number][];
};

/** The editable quest — the user's shape verbatim, MissionDef-backed fields kept. */
export type QuestDraft = {
  key: string;            // id
  title: string;
  author: string;
  questline: string;      // explicit questline NAME (the organizing field)
  client: string;         // fromNPC
  desc: string;
  reward: { cash?: number; repDelta?: number };
  requires: NonNullable<MissionDef['requires']>[number][]; // constraints
  events: QuestEvent[];
  // ── runtime-substrate fields, kept (demoted in the panel) ──
  verb: ActivityVerb;
  binding?: MissionDef['binding'];
  expiryTicks: number | null;
  collateral: { ratingDeltaPerCivilianKill: number };
  hooks: MissionDef['hooks'][number][];  // (text, worldDelta) — carries provides edges
  seed?: string;
};

function eventsFromStages(def: MissionDef): QuestEvent[] {
  return def.stages.map((stage, i) => {
    const marker = stage.objectives.find((o) => o.marker)?.marker
      ?? stage.objectives.map((o) => (o.target?.kind === 'point' ? { x: o.target.x, z: o.target.z } : null)).find(Boolean) ?? undefined;
    return {
      id: stage.id || `event-${i + 1}`,
      brief: stage.brief,
      location: marker ?? undefined,
      cutscene: '',
      dialog: [],
      objectives: [...stage.objectives],
    };
  });
}

function cloneDraft(def: MissionDef): QuestDraft {
  const base = JSON.parse(JSON.stringify({
    key: def.key,
    title: def.title,
    author: '',
    questline: '',
    client: def.client,
    desc: '',
    reward: def.reward,
    requires: def.requires ?? [],
    verb: def.verb,
    binding: def.binding,
    expiryTicks: def.expiryTicks,
    collateral: def.collateral,
    hooks: def.hooks,
    seed: def.seed,
  })) as QuestDraft;
  base.events = eventsFromStages(def);
  return base;
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
  // event focus — which beat the panel expands for deep editing
  focusedEvent(): number | null;
  focusEvent(index: number | null): void;
  addEvent(key: string): void;
  removeEvent(key: string, index: number): void;
  moveEvent(key: string, index: number, dir: -1 | 1): void;
  subscribe(fn: () => void): () => void;
}

export function createStoryStore(seed: readonly MissionDef[]): StoryStore {
  const drafts: QuestDraft[] = seed.map(cloneDraft);
  let selected: string | null = drafts[0]?.key ?? null;
  let focused: number | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };
  const byKey = (key: string) => drafts.find((d) => d.key === key) ?? null;

  // the graph reads only key/title/verb/client/binding/requires/hooks/questline
  // — never events — so the draft shape satisfies it as-is (extra fields ignored).
  const graphView = (): QuestGraph => buildQuestGraph(drafts as unknown as MissionDef[]);

  return {
    drafts: () => drafts,
    graph: graphView,
    selectedKey: () => selected,
    select: (key) => { if (key !== selected) focused = null; selected = key; notify(); },
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
    focusedEvent: () => focused,
    focusEvent: (index) => { focused = index; notify(); },
    addEvent: (key) => {
      const d = byKey(key);
      if (!d) return;
      const n = d.events.length + 1;
      d.events.push({ id: `event-${n}`, brief: `Event ${n}`, cutscene: '', dialog: [], objectives: [] });
      focused = d.events.length - 1;
      notify();
    },
    removeEvent: (key, index) => {
      const d = byKey(key);
      if (!d || index < 0 || index >= d.events.length) return;
      d.events.splice(index, 1);
      if (focused !== null && focused >= d.events.length) focused = d.events.length ? d.events.length - 1 : null;
      notify();
    },
    moveEvent: (key, index, dir) => {
      const d = byKey(key);
      if (!d) return;
      const to = index + dir;
      if (to < 0 || to >= d.events.length) return;
      const [ev] = d.events.splice(index, 1);
      d.events.splice(to, 0, ev);
      if (focused === index) focused = to;
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
