// editors/workbench/story/store.ts — the STORYLINE BOARD's working store.
//
// THE HIERARCHY IS QUESTLINE-FIRST (req_0919/req_0920, the user's ruling): you
// always pick a QUESTLINE before anything else — even one-off quests live in a
// misc/extra line, because the line is what keeps the board organized. A
// questline is a CREATED OBJECT, never a bare string: it owns a core array of
// missions, a summary, line-level requirements (the GREATER dependency — the
// missions inside carry their own), and line-level rewards (the bonus for
// finishing the whole line). The builder starts EMPTY — no seeded missions
// (the prior single seed was Claude placeholder, not authored content); the
// first move is always "New Questline".
//
// THE AUTHORED SHAPE IS THE USER'S (req_0910/req_0914), not MissionDef's: a
// quest is title / id / author / fromNPC / desc / reward / constraints /
// events(cutscene, location, order, dialog). The runtime MissionDef is the
// PROJECTION (events→stages, constraints→requires, fromNPC→client) the compile
// step makes — so authoring reads as the user thinks while still riding the
// ruled substrate. Fields MissionDef lacks (author, desc, per-event
// location/cutscene/dialog) and the whole Questline wrapper live here and
// persist with the editor; the V20 'storyline' stream is the persistence seam.
//
// The board graph is DERIVED on read (buildQuestGraph over the SELECTED line's
// missions) — never stored.

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

/** Line-level bonus for finishing the WHOLE line (atop each mission's reward). */
export type QuestlineRewards = { cash?: number; repDelta?: number };

/** THE TOP OF THE HIERARCHY (req_0919): a created object, not a string. Holds
 *  the core array of missions, a summary, the GREATER dependency (line-level
 *  requirements — the missions inside have their own), and the line reward. */
export type Questline = {
  id: string;
  title: string;
  summary: string;
  /** the greater dependency: gates that must hold before the line opens */
  requires: NonNullable<MissionDef['requires']>[number][];
  rewards: QuestlineRewards;
  /** the core array of missions */
  missions: QuestDraft[];
};

function blankDraft(key: string, n: number): QuestDraft {
  return {
    key,
    title: `Mission ${n}`,
    author: '',
    client: '',
    desc: '',
    reward: {},
    requires: [],
    events: [],
    verb: 'role',
    binding: undefined,
    expiryTicks: null,
    collateral: { ratingDeltaPerCivilianKill: 0 },
    hooks: [],
  };
}

function blankQuestline(id: string, n: number): Questline {
  return { id, title: `Questline ${n}`, summary: '', requires: [], rewards: {}, missions: [] };
}

const EMPTY_GRAPH: QuestGraph = { nodes: [], edges: [], external: [] };

export interface StoryStore {
  // ── questlines (the top of the hierarchy) ──
  questlines(): Questline[];
  line(id: string): Questline | null;
  selectedLineId(): string | null;
  selectLine(id: string | null): void;
  /** create a fresh questline, select it, clear mission selection; returns id */
  newQuestline(): string;
  removeQuestline(id: string): void;
  editLine(id: string, mutate: (l: Questline) => void): void;
  addLineGate(id: string, flag: string): void;
  removeLineGate(id: string, flag: string): void;

  // ── missions within the SELECTED line ──
  /** the conditional state machine over the SELECTED line's missions (empty
   *  when no line is selected). Derived on read — never stored. */
  graph(): QuestGraph;
  selectedKey(): string | null;
  select(key: string | null): void;
  draft(key: string): QuestDraft | null;
  /** add a blank mission to the selected line, select it; returns its key */
  newMission(): string | null;
  removeMission(key: string): void;
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

export function createStoryStore(): StoryStore {
  const lines: Questline[] = [];
  let selectedLine: string | null = null;
  let selected: string | null = null;
  let focused: number | null = null;
  // monotonic id counters (no Date.now/Math.random in the cart host)
  let lineSeq = 0;
  let missionSeq = 0;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };

  const lineByKey = (id: string) => lines.find((l) => l.id === id) ?? null;
  const currentLine = () => (selectedLine ? lineByKey(selectedLine) : null);
  const draftByKey = (key: string) => currentLine()?.missions.find((d) => d.key === key) ?? null;

  // the graph reads only key/title/verb/client/binding/requires/hooks — never
  // events — so the draft shape satisfies it as-is (extra fields ignored).
  const graphView = (): QuestGraph => {
    const line = currentLine();
    return line ? buildQuestGraph(line.missions as unknown as MissionDef[]) : EMPTY_GRAPH;
  };

  return {
    questlines: () => lines,
    line: lineByKey,
    selectedLineId: () => selectedLine,
    selectLine: (id) => {
      if (id !== selectedLine) { selected = null; focused = null; }
      selectedLine = id;
      notify();
    },
    newQuestline: () => {
      lineSeq += 1;
      const id = `line-${lineSeq}`;
      lines.push(blankQuestline(id, lineSeq));
      selectedLine = id;
      selected = null;
      focused = null;
      notify();
      return id;
    },
    removeQuestline: (id) => {
      const i = lines.findIndex((l) => l.id === id);
      if (i < 0) return;
      lines.splice(i, 1);
      if (selectedLine === id) { selectedLine = lines[i]?.id ?? lines[i - 1]?.id ?? null; selected = null; focused = null; }
      notify();
    },
    editLine: (id, mutate) => {
      const l = lineByKey(id);
      if (!l) return;
      mutate(l);
      notify();
    },
    addLineGate: (id, flag) => {
      const l = lineByKey(id);
      if (!l || !flag) return;
      if (l.requires.some((g) => g.kind === 'flag' && g.flag === flag)) return;
      l.requires.push({ kind: 'flag', flag });
      notify();
    },
    removeLineGate: (id, flag) => {
      const l = lineByKey(id);
      if (!l) return;
      l.requires = l.requires.filter((g) => !(g.kind === 'flag' && g.flag === flag));
      notify();
    },

    graph: graphView,
    selectedKey: () => selected,
    select: (key) => { if (key !== selected) focused = null; selected = key; notify(); },
    draft: draftByKey,
    newMission: () => {
      const line = currentLine();
      if (!line) return null;
      missionSeq += 1;
      const key = `quest-${missionSeq}`;
      line.missions.push(blankDraft(key, missionSeq));
      selected = key;
      focused = null;
      notify();
      return key;
    },
    removeMission: (key) => {
      const line = currentLine();
      if (!line) return;
      const i = line.missions.findIndex((d) => d.key === key);
      if (i < 0) return;
      line.missions.splice(i, 1);
      if (selected === key) { selected = line.missions[i]?.key ?? line.missions[i - 1]?.key ?? null; focused = null; }
      notify();
    },
    edit: (key, mutate) => {
      const d = draftByKey(key);
      if (!d) return;
      mutate(d);
      notify();
    },
    addFlagGate: (key, flag) => {
      const d = draftByKey(key);
      if (!d || !flag) return;
      if (d.requires.some((g) => g.kind === 'flag' && g.flag === flag)) return;
      d.requires.push({ kind: 'flag', flag });
      notify();
    },
    removeFlagGate: (key, flag) => {
      const d = draftByKey(key);
      if (!d) return;
      d.requires = d.requires.filter((g) => !(g.kind === 'flag' && g.flag === flag));
      notify();
    },
    focusedEvent: () => focused,
    focusEvent: (index) => { focused = index; notify(); },
    addEvent: (key) => {
      const d = draftByKey(key);
      if (!d) return;
      const n = d.events.length + 1;
      d.events.push({ id: `event-${n}`, brief: `Event ${n}`, cutscene: '', dialog: [], objectives: [] });
      focused = d.events.length - 1;
      notify();
    },
    removeEvent: (key, index) => {
      const d = draftByKey(key);
      if (!d || index < 0 || index >= d.events.length) return;
      d.events.splice(index, 1);
      if (focused !== null && focused >= d.events.length) focused = d.events.length ? d.events.length - 1 : null;
      notify();
    },
    moveEvent: (key, index, dir) => {
      const d = draftByKey(key);
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

/** The in-session singleton. Starts EMPTY — the first move is New Questline. */
export function storyWorkbenchStore(): StoryStore {
  if (!live) live = createStoryStore();
  return live;
}
