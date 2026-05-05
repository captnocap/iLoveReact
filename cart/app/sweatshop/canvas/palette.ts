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
import type { FlowNode } from '../../gallery/components/flow-editor/types';

export type PaletteTier = 'capability' | 'domain' | 'rules';

export type PaletteItem = {
  id: string;
  tier: PaletteTier;
  label: string;
  hint?: string;
  /** Build a partial FlowNode at the given drop point. The canvas
   *  generates the id and edge wiring. */
  spawn: (x: number, y: number) => FlowNode;
};

// ── Capability tier ───────────────────────────────────────────────

function capabilityNodes(): PaletteItem[] {
  const items: PaletteItem[] = [];
  // IFTTT trigger sources (subscribe-style). Each shows up as a "trigger" node.
  for (const prefix of listIfttSources()) {
    items.push({
      id: `cap-trigger-${prefix}`,
      tier: 'capability',
      label: prefix,
      hint: 'IFTTT trigger source',
      spawn: (x, y) => ({
        id: `trg_${Math.random().toString(36).slice(2, 8)}`,
        label: prefix,
        x, y,
        data: { kind: 'trigger', role: 'TRG', state: 'idle', stripe: 'trigger' },
      }),
    });
  }
  // IFTTT action verbs (run-style). Each is an "action" node.
  for (const prefix of listIfttActions()) {
    items.push({
      id: `cap-action-${prefix}`,
      tier: 'capability',
      label: prefix,
      hint: 'IFTTT action verb',
      spawn: (x, y) => ({
        id: `act_${Math.random().toString(36).slice(2, 8)}`,
        label: prefix,
        x, y,
        data: { kind: 'action', role: 'ACT', state: 'idle' },
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
    label: s.name,
    hint: s.hint,
    spawn: (x, y) => ({
      id: `dom_${s.name}_${Math.random().toString(36).slice(2, 8)}`,
      label: s.name,
      x, y,
      data: { kind: 'token', role: s.name.toUpperCase().slice(0, 3), state: 'idle' },
    }),
  }));
}

// ── Rules tier ────────────────────────────────────────────────────
// Recipe stamps + example rule patterns. Replace with reads from the
// `rule` table once the binder's discovery surface is exposed.

const RULE_STAMPS = [
  { id: 'rule-pathology-block', label: 'Pathology → halt-run', hint: 'event:pathology.detected → halt-run' },
  { id: 'rule-budget-warn',     label: 'Budget warn',          hint: 'event:budget.threshold-warned → notify-user' },
  { id: 'rule-finding-promote', label: 'Promote finding',      hint: 'event:research.finding-promoted → queue-job' },
  { id: 'rule-merge-celebrate', label: 'Merge celebrate',      hint: 'event:workstream.merged → consolidate-memory' },
];

function ruleNodes(): PaletteItem[] {
  return RULE_STAMPS.map((s) => ({
    id: s.id,
    tier: 'rules' as const,
    label: s.label,
    hint: s.hint,
    spawn: (x, y) => ({
      id: `rule_${Math.random().toString(36).slice(2, 8)}`,
      label: s.label,
      x, y,
      data: { kind: 'sequence', role: 'RULE', state: 'idle' },
    }),
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
