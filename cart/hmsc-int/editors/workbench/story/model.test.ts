// model.test.ts — P4 meaning-tests for the storyline board derivation.
//
// Behavior, not function names: a mission opens the flags its hooks set and
// gates on the flags it requires; the board's edges are exactly provider→
// requirer over those flags; depth is the longest prerequisite chain; a
// questline is a connected island; a required flag nobody provides is surfaced
// as external, never dropped. Runs under tools/v8cli via `rjit game verify`.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { defineMission } from '../../../game/missions';
import type { MissionDef } from '../../../game/missions';
import { buildQuestGraph, providesFlags, requiresFlags } from './model';

function quest(over: Partial<MissionDef> & { key: string }): MissionDef {
  return defineMission({
    key: over.key,
    title: over.title ?? over.key,
    verb: over.verb ?? 'role',
    client: over.client ?? 'client',
    stages: over.stages ?? [{ id: 's', brief: 'do it', objectives: [{ kind: 'talk', brief: 'talk', target: { kind: 'npc', id: 'n' } }] }],
    reward: over.reward ?? { cash: 10 },
    expiryTicks: over.expiryTicks ?? null,
    collateral: over.collateral ?? { ratingDeltaPerCivilianKill: 0 },
    hooks: over.hooks ?? [],
    requires: over.requires,
    binding: over.binding,
  });
}

// A two-quest chain: A opens `metKingpin`, B requires it.
const A = quest({
  key: 'a-intro',
  hooks: [{ at: 'complete', text: 'You met the kingpin.', worldDelta: { setFlag: 'metKingpin' } }],
});
const B = quest({
  key: 'b-job',
  requires: [{ kind: 'flag', flag: 'metKingpin' }],
  hooks: [{ at: 'complete', text: 'Job done.', worldDelta: { setFlag: 'firstJobDone' } }],
});
// C is an island in another questline, gated on a flag nobody here provides.
const C = quest({
  key: 'c-other',
  requires: [{ kind: 'flag', flag: 'opening.caas.unlocked' }],
});

test('a mission provides the flags its hooks set', () => {
  assertEqual(providesFlags(A).join(','), 'metKingpin', 'A provides metKingpin');
  assertEqual(providesFlags(C).join(','), '', 'C sets no flag, provides nothing');
});

test('a mission requires the flag gates it declares', () => {
  assertEqual(requiresFlags(B).join(','), 'metKingpin', 'B requires metKingpin');
  assertEqual(requiresFlags(A).join(','), '', 'A is a root — requires nothing');
});

test('an edge is provider → requirer over a shared flag', () => {
  const g = buildQuestGraph([A, B, C]);
  assertEqual(g.edges.length, 1, 'exactly one edge');
  const [e] = g.edges;
  assert(e.from === 'a-intro' && e.to === 'b-job' && e.flag === 'metKingpin', 'A→B on metKingpin');
});

test('depth is the longest prerequisite chain', () => {
  const g = buildQuestGraph([A, B, C]);
  const depthOf = (k: string) => g.nodes.find((n) => n.key === k)!.depth;
  assertEqual(depthOf('a-intro'), 0, 'A is a root');
  assertEqual(depthOf('b-job'), 1, 'B sits one column right of A');
  assertEqual(depthOf('c-other'), 0, 'C is its own root');
});

test('a required flag nobody provides is surfaced as external', () => {
  const g = buildQuestGraph([A, B, C]);
  assertEqual(g.external.length, 1, 'one unmet gate');
  assert(g.external[0].to === 'c-other' && g.external[0].flag === 'opening.caas.unlocked', 'C gates externally');
});

test('a questline is a connected island', () => {
  const g = buildQuestGraph([A, B, C]);
  const lineOf = (k: string) => g.nodes.find((n) => n.key === k)!.questline;
  assert(lineOf('a-intro') === lineOf('b-job'), 'A and B share a questline');
  assert(lineOf('c-other') !== lineOf('a-intro'), 'C is a separate questline');
});

finish('storyline board model');
