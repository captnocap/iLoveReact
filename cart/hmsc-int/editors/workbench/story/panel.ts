// editors/workbench/story/panel.ts — the STORYLINE BOARD's headless half: the
// roster (quests grouped by questline) and the per-quest PanelSpec the one
// field renderer draws. No React (the characters.test.ts bundling law).
//
// The panel edits the MissionDef SHAPE the user named — title, the V22 verb,
// the client (fromNPC), the PERSON/POSITION contract binding, the reward, and
// THE UNLOCK GATES (their "constraints"): each gate is a flag another quest
// provides, so authoring an edge is picking a flag, and the picker's options
// ARE the affordances (you can only gate on something the world opens). What a
// quest PROVIDES is derived from its hooks and shown read-only — you open gates
// by authoring hooks, not by asserting it here (PROTECT THE ZERO).

import type { FieldSpec, PanelSpec } from '../../../shell/fields';
import type { RosterRow } from '../../../shell/Workbench';
import { GAME_ACTIVITIES } from '../../../game/activities';
import type { ActivityVerb } from '../../../game/activities';
import type { StoryStore } from './store';

const BINDINGS = ['job', 'person', 'position'] as const;

/** roster = every quest, ordered (questline, column, lane); label carries the
 *  questline + verb so the flat rail still reads as grouped lines. */
export function storyRoster(store: StoryStore): RosterRow[] {
  const g = store.graph();
  const node = (key: string) => g.nodes.find((n) => n.key === key)!;
  return [...store.drafts()]
    .sort((a, b) => {
      const na = node(a.key);
      const nb = node(b.key);
      return na.questline - nb.questline || na.depth - nb.depth || na.lane - nb.lane;
    })
    .map((d) => {
      const n = node(d.key);
      return { id: d.key, label: `Q${n.questline + 1} · ${d.title}`, icon: 'GitBranch' };
    });
}

/** every flag any OTHER quest provides — the affordances a gate may name. */
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

export function storyPanel(store: StoryStore, key: string): PanelSpec {
  const d = store.draft(key);
  if (!d) return { groups: [{ title: 'QUEST', fields: [{ k: 'missing', t: 'val', get: () => 'no quest selected' }], layout: 'rows' }] };
  const g = store.graph();
  const node = g.nodes.find((n) => n.key === key)!;

  const identity: FieldSpec[] = [
    { k: 'title', t: 'text', get: () => d.title, set: (v) => store.edit(key, (x) => { x.title = v; }) },
    { k: 'id', t: 'val', get: () => d.key },
    { k: 'verb', t: 'enum', get: () => d.verb, opts: [...GAME_ACTIVITIES.VERBS], set: (v) => store.edit(key, (x) => { x.verb = v as ActivityVerb; }) },
    { k: 'client (fromNPC)', t: 'text', get: () => d.client, set: (v) => store.edit(key, (x) => { x.client = v; }) },
  ];

  const bindingKind = d.binding?.kind ?? 'job';
  const contract: FieldSpec[] = [
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
    contract.push({ k: 'npc id (grievance)', t: 'text', get: () => d.binding!.kind === 'person' ? d.binding!.npcId : '', set: (v) => store.edit(key, (x) => { if (x.binding?.kind === 'person') x.binding.npcId = v; }) });
  } else if (d.binding?.kind === 'position') {
    contract.push({ k: 'position id (racket)', t: 'text', get: () => d.binding!.kind === 'position' ? d.binding!.positionId : '', set: (v) => store.edit(key, (x) => { if (x.binding?.kind === 'position') x.binding.positionId = v; }) });
  }

  // THE CONDITIONAL SPINE — unlock gates (their "constraints") + provider edges
  const gates: FieldSpec[] = [];
  for (const flag of node.requiresFlags) {
    const fromQuest = g.edges.find((e) => e.to === key && e.flag === flag);
    const provenance = fromQuest ? `← ${g.nodes.find((n) => n.key === fromQuest.from)?.title ?? fromQuest.from}` : '⚠ external (arc/system)';
    gates.push({ k: `✕ ${flag}  ${provenance}`, t: 'act', tone: 'warning', run: () => store.removeFlagGate(key, flag) });
  }
  for (const gate of node.requiresOther) {
    gates.push({ k: gate.kind === 'counter' ? `${gate.counter} ≥ ${gate.atLeast}` : `event: ${gate.kind === 'event' ? gate.type : ''}`, t: 'val', get: () => '(non-flag gate)' });
  }
  gates.push({
    k: 'add unlock gate', t: 'pick', get: () => null,
    opts: () => gateOptions(store, key).filter((o) => !node.requiresFlags.includes(o.id)),
    set: (v) => { if (v) store.addFlagGate(key, v); },
    clearLabel: 'pick a flag another quest opens',
  });

  const provides: FieldSpec[] = node.providesFlags.length
    ? node.providesFlags.map((f) => ({ k: f, t: 'val' as const, get: () => 'set by a hook' }))
    : [{ k: 'none', t: 'val', get: () => 'this quest opens no gate (author a hook with worldDelta.setFlag)' }];

  const reward: FieldSpec[] = [
    { k: 'cash', t: 'num', get: () => d.reward.cash ?? 0, min: 0, max: 100000, step: 10, precision: 0, set: (v) => store.edit(key, (x) => { x.reward.cash = v; }) },
    { k: 'rep Δ', t: 'num', get: () => d.reward.repDelta ?? 0, min: -100, max: 100, step: 1, precision: 0, set: (v) => store.edit(key, (x) => { x.reward.repDelta = v; }) },
  ];

  const flow: FieldSpec[] = [
    { k: 'stages', t: 'val', get: () => `${d.stages.length} stage${d.stages.length === 1 ? '' : 's'}: ${d.stages.map((s) => s.id).join(' → ')}` },
    { k: 'hooks', t: 'val', get: () => `${d.hooks.length} narrative hook${d.hooks.length === 1 ? '' : 's'}` },
    { k: 'expiry', t: 'val', get: () => d.expiryTicks === null ? 'never expires' : `${d.expiryTicks} ticks` },
  ];

  return {
    groups: [
      { title: 'IDENTITY', fields: identity, layout: 'rows' },
      { title: 'CONTRACT (V22 person | position)', fields: contract, layout: 'rows' },
      { title: 'UNLOCK GATES — constraints', fields: gates, layout: 'rows' },
      { title: 'PROVIDES — what this opens', fields: provides, layout: 'rows' },
      { title: 'REWARD', fields: reward, layout: 'rows' },
      { title: 'FLOW', fields: flow, layout: 'rows' },
    ],
  };
}
