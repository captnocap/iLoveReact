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
// POST-ITS EVERYWHERE (req_0922): notes attach to questlines, missions, events,
// AND a general board pad — scattered thoughts kept in place, never one god
// notepad. WORLD TRANSITIONS (req_0921): a story point (mission/line anchor) can
// declare a persistent world-state change ("mission 3 complete → apartment
// catches fire"); this is the INFRA — the rich timeline editor is deferred.
//
// IT SAVES (req_0921, "notes that save"): the whole board persists to the twig
// file (cart/hmsc-int/sessions/_route-twigs.json) via the same door materials
// uses, so reload restores everything. The V20 'storyline' stream (undo chain)
// remains the heavier persistence follow-up.
//
// The board graph is DERIVED on read (buildQuestGraph over the SELECTED line's
// missions) — never stored.

import type { MissionDef } from '../../../game/missions';
import type { ActivityVerb } from '../../../game/activities';
import { buildQuestGraph, type QuestGraph } from './model';
import { nextSeqId, type Note, type WorldTransition } from './notes';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';

export type { Note, WorldChange, WorldTransition } from './notes';

const STORY_ROUTE = '/workbench/story';

/** One spoken line inside an event (the V16 cutscene-clock dialog). */
export type QuestDialogLine = { speaker: string; text: string };

/** THE USER'S "event": an ordered beat carrying its cutscene, location, dialog,
 *  and its own scattered post-its. Order is the array index. */
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
  /** post-its on this beat */
  notes: Note[];
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
  /** post-its on this mission */
  notes: Note[];
  /** transitional world states anchored at this mission's story points */
  transitions: WorldTransition[];
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

/** THE TOP OF THE HIERARCHY (req_0919): a created object, not a string. */
export type Questline = {
  id: string;
  title: string;
  summary: string;
  /** the greater dependency: gates that must hold before the line opens */
  requires: NonNullable<MissionDef['requires']>[number][];
  rewards: QuestlineRewards;
  /** the core array of missions */
  missions: QuestDraft[];
  /** post-its on the line as a whole */
  notes: Note[];
  /** transitional world states anchored at line-level points (start/complete) */
  transitions: WorldTransition[];
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
    notes: [],
    transitions: [],
    verb: 'role',
    binding: undefined,
    expiryTicks: null,
    collateral: { ratingDeltaPerCivilianKill: 0 },
    hooks: [],
  };
}

function blankQuestline(id: string, n: number): Questline {
  return { id, title: `Questline ${n}`, summary: '', requires: [], rewards: {}, missions: [], notes: [], transitions: [] };
}

/** Fill arrays older saved data may lack — forward migration on load. */
function normalizeLine(l: Questline): Questline {
  l.notes ??= [];
  l.transitions ??= [];
  l.requires ??= [];
  l.missions ??= [];
  for (const m of l.missions) {
    m.notes ??= [];
    m.transitions ??= [];
    m.requires ??= [];
    m.events ??= [];
    for (const e of m.events) e.notes ??= [];
  }
  return l;
}

function maxSeq(prefix: string, items: readonly { id: string }[]): number {
  const probe = nextSeqId(prefix, items);
  return parseInt(/(\d+)$/.exec(probe)![1], 10) - 1;
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

  // ── general board notes (the "in general" pad) ──
  generalNotes(): Note[];
  editGeneral(mutate: (notes: Note[]) => void): void;

  // ── missions within the SELECTED line ──
  graph(): QuestGraph;
  selectedKey(): string | null;
  select(key: string | null): void;
  draft(key: string): QuestDraft | null;
  newMission(): string | null;
  removeMission(key: string): void;
  /** the one writer — every mutator routes here (the persistence seam) */
  edit(key: string, mutate: (d: QuestDraft) => void): void;
  addFlagGate(key: string, flag: string): void;
  removeFlagGate(key: string, flag: string): void;
  focusedEvent(): number | null;
  focusEvent(index: number | null): void;
  addEvent(key: string): void;
  removeEvent(key: string, index: number): void;
  moveEvent(key: string, index: number, dir: -1 | 1): void;

  subscribe(fn: () => void): () => void;
}

export function createStoryStore(): StoryStore {
  // load persisted board (guarded — a twigless host degrades to empty/in-session)
  const load = <T,>(key: string, initial: T): T => {
    try { return readRouteTwigState(STORY_ROUTE, key, initial); } catch { return initial; }
  };
  const lines: Questline[] = (load<Questline[]>('lines', [])).map(normalizeLine);
  const general: Note[] = load<Note[]>('general', []);
  let selectedLine: string | null = load<string | null>('selLine', null);
  let selected: string | null = load<string | null>('selKey', null);
  let focused: number | null = null;
  // seed monotonic counters past whatever the saved data already used
  let lineSeq = maxSeq('line', lines);
  let missionSeq = lines.reduce((m, l) => Math.max(m, maxSeq('quest', l.missions)), 0);

  const listeners = new Set<() => void>();
  const persist = () => {
    try {
      writeRouteTwigState(STORY_ROUTE, 'lines', lines);
      writeRouteTwigState(STORY_ROUTE, 'general', general);
      writeRouteTwigState(STORY_ROUTE, 'selLine', selectedLine);
      writeRouteTwigState(STORY_ROUTE, 'selKey', selected);
    } catch { /* twigless host — stay in-session */ }
  };
  const notify = () => { persist(); for (const fn of listeners) fn(); };

  const lineByKey = (id: string) => lines.find((l) => l.id === id) ?? null;
  const currentLine = () => (selectedLine ? lineByKey(selectedLine) : null);
  const draftByKey = (key: string) => currentLine()?.missions.find((d) => d.key === key) ?? null;

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

    generalNotes: () => general,
    editGeneral: (mutate) => { mutate(general); notify(); },

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
      d.events.push({ id: `event-${n}`, brief: `Event ${n}`, cutscene: '', dialog: [], objectives: [], notes: [] });
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

/** The in-session singleton, rehydrated from the twig file. Empty on first run. */
export function storyWorkbenchStore(): StoryStore {
  if (!live) live = createStoryStore();
  return live;
}
