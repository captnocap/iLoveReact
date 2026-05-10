// Palette catalog for the sweatshop canvas.
//
// Three tiers per docs/02-canvas-and-substrates.md:
//
//   1. Capability — runtime/hooks/* + IFTTT registry sources/actions.
//      Each registered IFTTT prefix becomes a node. Plus a curated
//      list of hooks that aren't (yet) IFTTT-registered.
//   2. Domain — gallery/data shapes. Typed fields → ports. Currently
//      we expose the supervisor-architecture core shapes; the full
//      gallery surface lands in a follow-up.
//   3. Rules / effects — useIFTTT bindings. Currently a static list of
//      example rules; future: read from the rule table.
//
// `paletteItem.spawn` returns a partial FlowNode the canvas drops on
// the cursor location. Keep payloads minimal — the canvas owns layout.

import { listIfttSources, listIfttActions } from '@reactjit/runtime/hooks/ifttt-registry';
import type { FlowNode, FlowEdge } from '../../gallery/components/flow-editor/types';

export type PaletteTier = 'capability' | 'domain' | 'rules';

/**
 * Visible kind for an item in the palette UI. The capability tier
 * mixes triggers and actions (and rules expand to a wired pair); the
 * sidebar groups + tags by this so triggers and actions don't blur
 * together in the list. Domain tokens get their own kind so the rail
 * paints them with the same accent the canvas uses.
 */
export type PaletteItemKind = 'trigger' | 'action' | 'token' | 'rule';

export interface PaletteSpawn {
  nodes: FlowNode[];
  edges?: FlowEdge[];
}

export type PaletteItem = {
  id: string;
  tier: PaletteTier;
  /** What this item produces on the canvas. Drives the rail's group +
   *  badge styling (sidebar) and the rule-shape validator (canvas). */
  kind: PaletteItemKind;
  label: string;
  hint?: string;
  /** Build a spawn bundle at the given drop point. Single-node items
   *  return one node; rule stamps return a wired trigger+action+edge.
   *  Caller (sweatshop/page.tsx handleSpawn) appends both arrays. */
  spawn: (x: number, y: number) => PaletteSpawn;
};

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

// ── Capability tier ───────────────────────────────────────────────

function capabilityNodes(): PaletteItem[] {
  const items: PaletteItem[] = [];
  // IFTTT trigger sources (subscribe-style). Each shows up as a "trigger" node.
  for (const prefix of listIfttSources()) {
    items.push({
      id: `cap-trigger-${prefix}`,
      tier: 'capability',
      kind: 'trigger',
      label: prefix,
      hint: 'fires when this happens',
      spawn: (x, y) => ({
        nodes: [{
          id: newId('trg'),
          label: prefix,
          x, y,
          data: { kind: 'trigger', role: 'TRG', state: 'idle', stripe: 'trigger' },
        }],
      }),
    });
  }
  // IFTTT action verbs (run-style). Each is an "action" node.
  for (const prefix of listIfttActions()) {
    items.push({
      id: `cap-action-${prefix}`,
      tier: 'capability',
      kind: 'action',
      label: prefix,
      hint: 'runs when triggered',
      spawn: (x, y) => ({
        nodes: [{
          id: newId('act'),
          label: prefix,
          x, y,
          data: { kind: 'action', role: 'ACT', state: 'idle' },
        }],
      }),
    });
  }
  return items;
}

// ── Domain tier ───────────────────────────────────────────────────
// Curated set of supervisor-architecture shapes. The full gallery
// surface lands when the gallery exposes a typed manifest of shape
// names — for now we hand-list the load-bearing ones.

const DOMAIN_SHAPES = [
  { name: 'Goal',           hint: 'objective in user words' },
  { name: 'Plan',           hint: 'approach, decomposed into phases' },
  { name: 'Task',           hint: 'concrete unit of work' },
  { name: 'Worker',         hint: 'runtime executor' },
  { name: 'Supervisor',     hint: 'task-local enforcer' },
  { name: 'Connection',     hint: 'how a model is reached' },
  { name: 'Model',          hint: 'specific endpoint' },
  { name: 'Rule',           hint: 'IF-THIS-THEN-THAT row' },
  { name: 'Pathology',      hint: 'past-injury behavior floor' },
  { name: 'Constraint',     hint: 'task contract requirement' },
  { name: 'Composition',    hint: 'multi-stage work definition' },
  { name: 'CompositionRun', hint: 'per-execution snapshot' },
];

function domainNodes(): PaletteItem[] {
  return DOMAIN_SHAPES.map((s) => ({
    id: `dom-${s.name}`,
    tier: 'domain' as const,
    kind: 'token' as const,
    label: s.name,
    hint: s.hint,
    spawn: (x, y) => ({
      nodes: [{
        id: newId(`dom_${s.name}`),
        label: s.name,
        x, y,
        data: { kind: 'token', role: s.name.toUpperCase().slice(0, 3), state: 'idle' },
      }],
    }),
  }));
}

// ── Rules tier ────────────────────────────────────────────────────
// Recipe stamps + example rule patterns. Replace with reads from the
// `rule` table once the binder's discovery surface is exposed.

interface RuleStamp { id: string; label: string; hint: string; trigger: string; action: string }

const RULE_STAMPS: RuleStamp[] = [
  {
    id: 'rule-pathology-block',
    label: 'Pathology → halt-run',
    hint: 'When a pathology is detected, halt the run.',
    trigger: 'event:pathology.detected',
    action:  'halt-run',
  },
  {
    id: 'rule-budget-warn',
    label: 'Budget warn',
    hint: 'When budget threshold is hit, notify the user.',
    trigger: 'event:budget.threshold-warned',
    action:  'notify-user:Budget threshold hit',
  },
  {
    id: 'rule-finding-promote',
    label: 'Promote finding',
    hint: 'When a research finding is promoted, queue a follow-up job.',
    trigger: 'event:research.finding-promoted',
    action:  'queue-job:promote',
  },
  {
    id: 'rule-merge-celebrate',
    label: 'Merge celebrate',
    hint: 'On a merged workstream, consolidate memory.',
    trigger: 'event:workstream.merged',
    action:  'commit-state',
  },
];

function ruleNodes(): PaletteItem[] {
  return RULE_STAMPS.map((s) => ({
    id: s.id,
    tier: 'rules' as const,
    kind: 'rule' as const,
    label: s.label,
    hint: s.hint,
    spawn: (x, y) => {
      // A rule stamp expands to a real wired pair so it shows up in
      // the code projection as one useIFTTT(...) line. Trigger goes
      // on the left, action on the right with a single edge between.
      const trgId = newId('trg');
      const actId = newId('act');
      const edgeId = newId('edge');
      return {
        nodes: [
          {
            id: trgId,
            label: s.trigger,
            x, y,
            data: { kind: 'trigger', role: 'TRG', state: 'idle', stripe: 'trigger' },
          },
          {
            id: actId,
            label: s.action,
            x: x + 240, y,
            data: { kind: 'action', role: 'ACT', state: 'idle' },
          },
        ],
        edges: [
          { id: edgeId, from: trgId, to: actId, fromPort: 'out', toPort: 'in' },
        ],
      };
    },
  }));
}

// ── Public API ────────────────────────────────────────────────────

export function buildPalette(): PaletteItem[] {
  return [
    ...capabilityNodes(),
    ...domainNodes(),
    ...ruleNodes(),
  ];
}

export const PALETTE_TIERS: Array<{ id: PaletteTier; label: string; hint: string }> = [
  { id: 'capability', label: 'Capabilities', hint: 'runtime/hooks + IFTTT sources/actions' },
  { id: 'domain',     label: 'Domain',       hint: 'gallery shapes — Goal, Plan, Worker…' },
  { id: 'rules',      label: 'Rules',        hint: 'IF-THIS-THEN-THAT stamps' },
];
