// editors/workbench/story/panel.ts — the STORYLINE BOARD's headless half: the
// roster (a general-notes pad, then every questline with its missions nested)
// and the PanelSpec the one field renderer draws. No React (the bundling law).
//
// THE HIERARCHY IS QUESTLINE-FIRST (req_0919/req_0920). POST-ITS EVERYWHERE
// (req_0922): a NOTES group rides the general pad, every questline, every
// mission, and every event — scattered thoughts kept in place. WORLD
// TRANSITIONS (req_0921): a TRANSITIONS group on missions and lines anchors a
// persistent world-state change at a story point (the infra; the rich timeline
// editor is deferred).
//
// QUESTLINE panel: identity · requirements (greater dependency) · rewards
// (finish-the-line) · missions · notes · transitions.
// MISSION panel: identity · constraints · dependents · reward · events ·
// notes · transitions · wiring(substrate, demoted).

import type { FieldSpec, PanelSpec } from '../../../shell/fields';
import type { RosterRow } from '../../../shell/Workbench';
import { GAME_ACTIVITIES } from '../../../game/activities';
import type { ActivityVerb } from '../../../game/activities';
import type { StoryStore } from './store';
import {
  addNote, setNote, removeNote,
  addTransition, removeTransition, setTransitionLabel, addChange, removeChange, setChange,
  type Note, type WorldTransition,
} from './notes';

const BINDINGS = ['job', 'person', 'position'] as const;
const COORD = { min: -100000, max: 100000, step: 1, precision: 1 } as const;

const GENERAL_ROW = 'G:';

/** Roster row ids encode the hierarchy: `G:` the general pad, `L:<lineId>` a
 *  questline header, `M:<lineId>:<key>` a mission under it. */
export const lineRowId = (lineId: string) => `L:${lineId}`;
export const missionRowId = (lineId: string, key: string) => `M:${lineId}:${key}`;
export function parseRowId(rowId: string): { general: true } | { line: string; mission?: string } | null {
  if (rowId === GENERAL_ROW) return { general: true };
  if (rowId.startsWith('L:')) return { line: rowId.slice(2) };
  if (rowId.startsWith('M:')) {
    const rest = rowId.slice(2);
    const i = rest.indexOf(':');
    if (i < 0) return null;
    return { line: rest.slice(0, i), mission: rest.slice(i + 1) };
  }
  return null;
}

/** roster = the general pad, then every questline with its (indented) missions. */
export function storyRoster(store: StoryStore): RosterRow[] {
  const rows: RosterRow[] = [{ id: GENERAL_ROW, label: '📌 General Notes', icon: 'SquarePen' }];
  for (const line of store.questlines()) {
    rows.push({ id: lineRowId(line.id), label: line.title || '(untitled line)', icon: 'GitBranch' });
    for (const m of line.missions) {
      rows.push({ id: missionRowId(line.id, m.key), label: `   ↳ ${m.title}`, icon: 'ListChecks' });
    }
  }
  return rows;
}

// ── shared post-it + transition builders (one impl, reused on every surface) ──

type NoteCommit = (mutate: (arr: Note[]) => void) => void;
type TransitionCommit = (mutate: (arr: WorldTransition[]) => void) => void;

function notesFields(notes: Note[], commit: NoteCommit): FieldSpec[] {
  const fields: FieldSpec[] = [];
  notes.forEach((note, i) => {
    fields.push({ k: `📌 ${i + 1}`, t: 'text', width: 2, get: () => note.text, set: (v) => commit((arr) => setNote(arr, note.id, v)), placeholder: 'a thought, a TODO, a feature this needs…' });
    fields.push({ k: `✕ remove note ${i + 1}`, t: 'act', tone: 'warning', run: () => commit((arr) => removeNote(arr, note.id)) });
  });
  if (notes.length === 0) fields.push({ k: 'none', t: 'val', get: () => 'no notes here yet' });
  fields.push({ k: '+ add note', t: 'act', tone: 'accent', run: () => commit(addNote) });
  return fields;
}

function transitionsFields(transitions: WorldTransition[], anchors: { id: string; label: string }[], commit: TransitionCommit): FieldSpec[] {
  const fields: FieldSpec[] = [];
  transitions.forEach((t, ti) => {
    const anchorLabel = anchors.find((a) => a.id === t.at)?.label ?? t.at;
    fields.push({ k: `◆ ${ti + 1} · ${anchorLabel}`, t: 'text', width: 2, get: () => t.label, set: (v) => commit((arr) => setTransitionLabel(arr, t.id, v)), placeholder: 'what changes (e.g. apartment building catches fire)' });
    t.changes.forEach((c, ci) => {
      fields.push({ k: `target ${ti + 1}.${ci + 1}`, t: 'text', get: () => c.target, set: (v) => commit((arr) => { const tr = arr.find((x) => x.id === t.id); if (tr) setChange(tr, c.id, { target: v }); }), placeholder: 'what in the world (building, prop, npc…)' });
      fields.push({ k: `effect ${ti + 1}.${ci + 1}`, t: 'text', get: () => c.effect, set: (v) => commit((arr) => { const tr = arr.find((x) => x.id === t.id); if (tr) setChange(tr, c.id, { effect: v }); }), placeholder: 'the new persistent state' });
      fields.push({ k: `✕ change ${ti + 1}.${ci + 1}`, t: 'act', tone: 'warning', run: () => commit((arr) => { const tr = arr.find((x) => x.id === t.id); if (tr) removeChange(tr, c.id); }) });
    });
    fields.push({ k: `+ add change (transition ${ti + 1})`, t: 'act', tone: 'accent', run: () => commit((arr) => { const tr = arr.find((x) => x.id === t.id); if (tr) addChange(tr); }) });
    fields.push({ k: `✕ remove transition ${ti + 1}`, t: 'act', tone: 'warning', run: () => commit((arr) => removeTransition(arr, t.id)) });
  });
  if (transitions.length === 0) fields.push({ k: 'none', t: 'val', get: () => 'no transitions — anchor a world change at a story point' });
  fields.push({
    k: 'add transition at…', t: 'pick', get: () => null,
    opts: () => anchors,
    set: (v) => { if (v) commit((arr) => addTransition(arr, v)); },
    clearLabel: 'pick a story point',
  });
  return fields;
}

// ── general notes pad ──────────────────────────────────────────────────────────

function generalPanel(store: StoryStore): PanelSpec {
  return {
    groups: [{
      title: 'GENERAL NOTES',
      fields: notesFields(store.generalNotes(), (m) => store.editGeneral(m)),
      layout: 'rows',
    }],
  };
}

// ── QUESTLINE panel ──────────────────────────────────────────────────────────

/** flags any mission in ANOTHER line provides — the greater dependency's
 *  affordances (a line gates on what an upstream line opens). */
function lineGateOptions(store: StoryStore, selfLine: string): { id: string; label: string; group?: string }[] {
  const out: { id: string; label: string; group?: string }[] = [];
  const seen = new Set<string>();
  for (const line of store.questlines()) {
    if (line.id === selfLine) continue;
    for (const m of line.missions) {
      for (const hook of m.hooks) {
        const delta = hook.worldDelta as Record<string, unknown>;
        const flags = typeof delta.setFlag === 'string' ? [delta.setFlag]
          : Array.isArray(delta.setFlags) ? delta.setFlags.filter((f): f is string => typeof f === 'string') : [];
        for (const flag of flags) {
          if (seen.has(flag)) continue;
          seen.add(flag);
          out.push({ id: flag, label: flag, group: line.title });
        }
      }
    }
  }
  return out;
}

const LINE_ANCHORS = [{ id: 'start', label: 'on line start' }, { id: 'complete', label: 'on line complete' }];

function lineIdentityGroup(store: StoryStore, id: string): FieldSpec[] {
  const l = store.line(id)!;
  return [
    { k: 'title', t: 'text', get: () => l.title, set: (v) => store.editLine(id, (x) => { x.title = v; }) },
    { k: 'id', t: 'val', get: () => l.id },
    { k: 'summary', t: 'text', get: () => l.summary, set: (v) => store.editLine(id, (x) => { x.summary = v; }), width: 2, placeholder: 'what this whole line is about' },
  ];
}

function lineRequirementsGroup(store: StoryStore, id: string): FieldSpec[] {
  const l = store.line(id)!;
  const fields: FieldSpec[] = [];
  for (const gate of l.requires) {
    if (gate.kind !== 'flag') continue;
    fields.push({ k: `✕ ${gate.flag}`, t: 'act', tone: 'warning', run: () => store.removeLineGate(id, gate.flag) });
  }
  fields.push({
    k: 'add requirement', t: 'pick', get: () => null,
    opts: () => lineGateOptions(store, id).filter((o) => !l.requires.some((g) => g.kind === 'flag' && g.flag === o.id)),
    set: (v) => { if (v) store.addLineGate(id, v); },
    clearLabel: 'pick a flag an upstream line opens',
  });
  if (fields.length === 1) fields.unshift({ k: 'none', t: 'val', get: () => 'open from the start (no greater dependency)' });
  return fields;
}

function lineRewardsGroup(store: StoryStore, id: string): FieldSpec[] {
  const l = store.line(id)!;
  return [
    { k: 'cash', t: 'num', get: () => l.rewards.cash ?? 0, min: 0, max: 1000000, step: 25, precision: 0, set: (v) => store.editLine(id, (x) => { x.rewards.cash = v; }) },
    { k: 'rep Δ', t: 'num', get: () => l.rewards.repDelta ?? 0, min: -100, max: 100, step: 1, precision: 0, set: (v) => store.editLine(id, (x) => { x.rewards.repDelta = v; }) },
  ];
}

function lineMissionsGroup(store: StoryStore, id: string): FieldSpec[] {
  const l = store.line(id)!;
  const fields: FieldSpec[] = l.missions.map((m) => ({
    k: `▸ ${m.title}`, t: 'act' as const, run: () => store.select(m.key),
  }));
  if (l.missions.length === 0) fields.push({ k: 'none', t: 'val', get: () => 'no missions yet — add the first' });
  fields.push({ k: '+ add mission', t: 'act', tone: 'accent', run: () => store.newMission() });
  return fields;
}

function questlinePanel(store: StoryStore, id: string): PanelSpec {
  const l = store.line(id)!;
  return {
    groups: [
      { title: 'QUESTLINE', fields: lineIdentityGroup(store, id), layout: 'rows' },
      { title: 'REQUIREMENTS (greater dependency)', fields: lineRequirementsGroup(store, id), layout: 'rows' },
      { title: 'REWARDS (finish the line)', fields: lineRewardsGroup(store, id), layout: 'rows' },
      { title: 'MISSIONS', fields: lineMissionsGroup(store, id), layout: 'rows' },
      { title: 'NOTES', fields: notesFields(l.notes, (m) => store.editLine(id, (x) => m(x.notes))), layout: 'rows' },
      { title: 'TRANSITIONS (world state)', fields: transitionsFields(l.transitions, LINE_ANCHORS, (m) => store.editLine(id, (x) => m(x.transitions))), layout: 'rows' },
    ],
  };
}

// ── MISSION panel ────────────────────────────────────────────────────────────

/** every flag any OTHER mission in this line provides — the affordances a
 *  constraint may name. */
function gateOptions(store: StoryStore, selfKey: string): { id: string; label: string; group?: string }[] {
  const g = store.graph();
  const out: { id: string; label: string; group?: string }[] = [];
  const seen = new Set<string>();
  for (const n of g.nodes) {
    if (n.key === selfKey) continue;
    for (const flag of n.providesFlags) {
      if (seen.has(flag)) continue;
      seen.add(flag);
      out.push({ id: flag, label: flag, group: n.title });
    }
  }
  return out;
}

/** the story points a mission transition can anchor to. */
function missionAnchors(store: StoryStore, key: string): { id: string; label: string }[] {
  const d = store.draft(key)!;
  return [
    { id: 'accept', label: 'on accept' },
    { id: 'complete', label: 'on complete' },
    { id: 'fail', label: 'on fail' },
    ...d.events.map((e, i) => ({ id: `event:${e.id}`, label: `after event ${i + 1}: ${e.brief}` })),
  ];
}

function identityGroup(store: StoryStore, key: string): FieldSpec[] {
  const d = store.draft(key)!;
  return [
    { k: 'title', t: 'text', get: () => d.title, set: (v) => store.edit(key, (x) => { x.title = v; }) },
    { k: 'id', t: 'val', get: () => d.key },
    { k: 'author', t: 'text', get: () => d.author, set: (v) => store.edit(key, (x) => { x.author = v; }), placeholder: 'who wrote this quest' },
    { k: 'fromNPC', t: 'text', get: () => d.client, set: (v) => store.edit(key, (x) => { x.client = v; }) },
    { k: 'desc', t: 'text', get: () => d.desc, set: (v) => store.edit(key, (x) => { x.desc = v; }), width: 2, placeholder: 'what this quest is about' },
  ];
}

function constraintsGroup(store: StoryStore, key: string): FieldSpec[] {
  const g = store.graph();
  const node = g.nodes.find((n) => n.key === key)!;
  const fields: FieldSpec[] = [];
  for (const flag of node.requiresFlags) {
    const edge = g.edges.find((e) => e.to === key && e.flag === flag);
    const provenance = edge ? `← ${g.nodes.find((n) => n.key === edge.from)?.title ?? edge.from}` : '⚠ external (arc/system)';
    fields.push({ k: `✕ ${flag}  ${provenance}`, t: 'act', tone: 'warning', run: () => store.removeFlagGate(key, flag) });
  }
  for (const gate of node.requiresOther) {
    fields.push({ k: gate.kind === 'counter' ? `${gate.counter} ≥ ${gate.atLeast}` : `event: ${gate.kind === 'event' ? gate.type : ''}`, t: 'val', get: () => '(non-flag gate)' });
  }
  fields.push({
    k: 'add constraint', t: 'pick', get: () => null,
    opts: () => gateOptions(store, key).filter((o) => !node.requiresFlags.includes(o.id)),
    set: (v) => { if (v) store.addFlagGate(key, v); },
    clearLabel: 'pick a flag another quest opens',
  });
  if (fields.length === 1) fields.unshift({ k: 'none', t: 'val', get: () => 'offerable from the start (no constraints)' });
  return fields;
}

function dependentsGroup(store: StoryStore, key: string): FieldSpec[] {
  const g = store.graph();
  const downstream = g.edges.filter((e) => e.from === key);
  if (downstream.length === 0) return [{ k: 'none', t: 'val', get: () => 'nothing depends on this quest yet' }];
  return downstream.map((e) => ({
    k: `→ ${g.nodes.find((n) => n.key === e.to)?.title ?? e.to}`,
    t: 'val' as const,
    get: () => `unlocks via ${e.flag}`,
  }));
}

function rewardGroup(store: StoryStore, key: string): FieldSpec[] {
  const d = store.draft(key)!;
  return [
    { k: 'cash', t: 'num', get: () => d.reward.cash ?? 0, min: 0, max: 100000, step: 10, precision: 0, set: (v) => store.edit(key, (x) => { x.reward.cash = v; }) },
    { k: 'rep Δ', t: 'num', get: () => d.reward.repDelta ?? 0, min: -100, max: 100, step: 1, precision: 0, set: (v) => store.edit(key, (x) => { x.reward.repDelta = v; }) },
  ];
}

/** EVENTS — the ordered beats. The list focuses a beat; the focused beat
 *  expands into its own group (location, cutscene, dialog, notes). */
function eventsGroup(store: StoryStore, key: string): FieldSpec[] {
  const d = store.draft(key)!;
  const focused = store.focusedEvent();
  const fields: FieldSpec[] = [];
  d.events.forEach((ev, i) => {
    const loc = ev.location ? ` @(${ev.location.x},${ev.location.z})` : '';
    const mark = i === focused ? '▾ ' : '▸ ';
    fields.push({ k: `${mark}${i + 1}. ${ev.brief}${loc}`, t: 'act', tone: i === focused ? 'primary' : undefined, run: () => store.focusEvent(i === focused ? null : i) });
  });
  if (d.events.length === 0) fields.push({ k: 'none', t: 'val', get: () => 'no events yet — add the first beat' });
  fields.push({ k: '+ add event', t: 'act', tone: 'accent', run: () => store.addEvent(key) });
  return fields;
}

function focusedEventGroup(store: StoryStore, key: string): FieldSpec[] | null {
  const d = store.draft(key)!;
  const i = store.focusedEvent();
  if (i === null || i < 0 || i >= d.events.length) return null;
  const ev = d.events[i];
  const fields: FieldSpec[] = [
    { k: 'brief', t: 'text', get: () => ev.brief, set: (v) => store.edit(key, (x) => { x.events[i].brief = v; }) },
    { k: 'order', t: 'val', get: () => `${i + 1} of ${d.events.length}` },
    { k: '▲ earlier', t: 'act', run: () => store.moveEvent(key, i, -1) },
    { k: '▼ later', t: 'act', run: () => store.moveEvent(key, i, 1) },
    { k: '✕ remove event', t: 'act', tone: 'warning', run: () => store.removeEvent(key, i) },
    { k: 'location x', t: 'num', get: () => ev.location?.x ?? 0, ...COORD, set: (v) => store.edit(key, (x) => { const e = x.events[i]; e.location = { x: v, z: e.location?.z ?? 0 }; }) },
    { k: 'location z', t: 'num', get: () => ev.location?.z ?? 0, ...COORD, set: (v) => store.edit(key, (x) => { const e = x.events[i]; e.location = { x: e.location?.x ?? 0, z: v }; }) },
    { k: 'cutscene', t: 'text', get: () => ev.cutscene, set: (v) => store.edit(key, (x) => { x.events[i].cutscene = v; }), placeholder: 'cutscene id (game/cutscene)' },
  ];
  ev.dialog.forEach((line, di) => {
    fields.push({ k: `speaker ${di + 1}`, t: 'text', get: () => line.speaker, set: (v) => store.edit(key, (x) => { x.events[i].dialog[di].speaker = v; }), placeholder: 'npc id' });
    fields.push({ k: `line ${di + 1}`, t: 'text', get: () => line.text, set: (v) => store.edit(key, (x) => { x.events[i].dialog[di].text = v; }), width: 2 });
    fields.push({ k: `✕ remove line ${di + 1}`, t: 'act', tone: 'warning', run: () => store.edit(key, (x) => { x.events[i].dialog.splice(di, 1); }) });
  });
  fields.push({ k: '+ add dialog line', t: 'act', tone: 'accent', run: () => store.edit(key, (x) => { x.events[i].dialog.push({ speaker: '', text: '' }); }) });
  fields.push({ k: 'objectives', t: 'val', get: () => ev.objectives.length ? `${ev.objectives.length} (target-pickers: next pass)` : 'none yet' });
  // post-its on this beat
  for (const f of notesFields(ev.notes, (m) => store.edit(key, (x) => m(x.events[i].notes)))) fields.push(f);
  return fields;
}

function wiringGroup(store: StoryStore, key: string): FieldSpec[] {
  const d = store.draft(key)!;
  const bindingKind = d.binding?.kind ?? 'job';
  const fields: FieldSpec[] = [
    { k: 'verb (gameplay)', t: 'enum', get: () => d.verb, opts: [...GAME_ACTIVITIES.VERBS], set: (v) => store.edit(key, (x) => { x.verb = v as ActivityVerb; }) },
    {
      k: 'binding', t: 'enum', get: () => bindingKind, opts: [...BINDINGS],
      set: (v) => store.edit(key, (x) => {
        if (v === 'job') x.binding = undefined;
        else if (v === 'person') x.binding = { kind: 'person', npcId: x.binding?.kind === 'person' ? x.binding.npcId : '' };
        else x.binding = { kind: 'position', positionId: x.binding?.kind === 'position' ? x.binding.positionId : '' };
      }),
    },
  ];
  if (d.binding?.kind === 'person') {
    fields.push({ k: 'npc id (grievance)', t: 'text', get: () => d.binding!.kind === 'person' ? d.binding!.npcId : '', set: (v) => store.edit(key, (x) => { if (x.binding?.kind === 'person') x.binding.npcId = v; }) });
  } else if (d.binding?.kind === 'position') {
    fields.push({ k: 'position id (racket)', t: 'text', get: () => d.binding!.kind === 'position' ? d.binding!.positionId : '', set: (v) => store.edit(key, (x) => { if (x.binding?.kind === 'position') x.binding.positionId = v; }) });
  }
  fields.push({ k: 'expiry', t: 'val', get: () => d.expiryTicks === null ? 'never expires' : `${d.expiryTicks} ticks` });
  return fields;
}

function missionPanel(store: StoryStore, key: string): PanelSpec {
  const d = store.draft(key)!;
  const groups: PanelSpec['groups'] = [
    { title: 'IDENTITY', fields: identityGroup(store, key), layout: 'rows' },
    { title: 'CONSTRAINTS', fields: constraintsGroup(store, key), layout: 'rows' },
    { title: 'DEPENDENTS', fields: dependentsGroup(store, key), layout: 'rows' },
    { title: 'REWARD', fields: rewardGroup(store, key), layout: 'rows' },
    { title: 'EVENTS', fields: eventsGroup(store, key), layout: 'rows' },
  ];
  const focused = focusedEventGroup(store, key);
  if (focused) groups.push({ title: 'EVENT — cutscene · location · dialog · notes', fields: focused, layout: 'rows' });
  groups.push({ title: 'NOTES', fields: notesFields(d.notes, (m) => store.edit(key, (x) => m(x.notes))), layout: 'rows' });
  groups.push({ title: 'TRANSITIONS (world state)', fields: transitionsFields(d.transitions, missionAnchors(store, key), (m) => store.edit(key, (x) => m(x.transitions))), layout: 'rows' });
  groups.push({ title: 'WIRING (substrate)', fields: wiringGroup(store, key), layout: 'rows', tier: 'debug' });
  return { groups };
}

/** The panel dispatches on selection (truth lives in the store): a selected
 *  mission → mission panel; else a selected questline → questline panel; else
 *  the general notes pad (the landing). */
export function storyPanel(store: StoryStore): PanelSpec {
  const key = store.selectedKey();
  if (key && store.draft(key)) return missionPanel(store, key);
  const lineId = store.selectedLineId();
  if (lineId && store.line(lineId)) return questlinePanel(store, lineId);
  return generalPanel(store);
}
